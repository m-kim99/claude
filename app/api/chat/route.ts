import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@/lib/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const STORAGE_BUCKET = 'chat-images';
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_LENGTH = 7_000_000; // 약 5MB 바이너리
const MAX_HISTORY_IMAGES = 8; // 히스토리에서 실제 이미지로 포함할 최대 장수 (토큰 비용 제어)
const IMAGE_PLACEHOLDER = '[이미지 첨부됨]';
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

type Block = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
interface BlockMessage {
  role: 'user' | 'assistant';
  blocks: Block[];
}

function ensureAlternating(messages: BlockMessage[]): BlockMessage[] {
  const result: BlockMessage[] = [];
  for (const msg of messages) {
    if (msg.blocks.length === 0) continue;
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.blocks = [...last.blocks, ...msg.blocks];
    } else {
      result.push({ role: msg.role, blocks: [...msg.blocks] });
    }
  }
  return result;
}

function toApiMessages(
  messages: BlockMessage[],
  dateInfo: string,
  cacheControl: Anthropic.CacheControlEphemeral
): Anthropic.MessageParam[] {
  const lastIndex = messages.length - 1;
  const cacheIndex = messages.length - 2;
  return messages.map((m, i) => {
    let blocks = m.blocks;
    if (i === lastIndex) {
      blocks = [...blocks, { type: 'text', text: dateInfo }];
    }
    if (i === cacheIndex) {
      blocks = blocks.map((b, j) =>
        j === blocks.length - 1 ? ({ ...b, cache_control: cacheControl } as Block) : b
      );
    }
    return { role: m.role, content: blocks };
  });
}

// URL 이미지 블록 제거 (Anthropic이 URL을 가져오지 못해 실패할 때의 폴백)
function stripUrlImages(messages: BlockMessage[]): BlockMessage[] {
  return messages.map((m) => {
    const blocks = m.blocks.filter((b) => !(b.type === 'image' && b.source.type === 'url'));
    return {
      role: m.role,
      blocks: blocks.length > 0 ? blocks : [{ type: 'text' as const, text: IMAGE_PLACEHOLDER }],
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const { content, contextMode = '20turns', images = [] } = await req.json();
    const text: string = typeof content === 'string' ? content : '';
    const rawImages: { data?: unknown; mediaType?: unknown }[] = Array.isArray(images) ? images : [];

    if (!text.trim() && rawImages.length === 0) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }
    if (rawImages.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.` },
        { status: 400 }
      );
    }
    for (const img of rawImages) {
      if (
        typeof img?.data !== 'string' ||
        img.data.length === 0 ||
        typeof img?.mediaType !== 'string' ||
        !(img.mediaType in IMAGE_EXT)
      ) {
        return NextResponse.json({ error: '지원하지 않는 이미지 형식입니다.' }, { status: 400 });
      }
      if (img.data.length > MAX_IMAGE_BASE64_LENGTH) {
        return NextResponse.json({ error: '이미지가 너무 큽니다. (최대 약 5MB)' }, { status: 400 });
      }
    }
    const userImages = rawImages as { data: string; mediaType: string }[];

    const supabase = createServerClient();

    // 이미지 → Supabase Storage 업로드 (히스토리 표시/재사용을 위해 URL 보존)
    const imageUrls: string[] = [];
    for (const img of userImages) {
      const path = `${Date.now()}-${crypto.randomUUID()}.${IMAGE_EXT[img.mediaType]}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, Buffer.from(img.data, 'base64'), { contentType: img.mediaType });
      if (uploadError) {
        const hint = /bucket/i.test(uploadError.message)
          ? ` — Supabase Storage에 '${STORAGE_BUCKET}' 공개(public) 버킷을 생성해주세요.`
          : '';
        return NextResponse.json(
          { error: `이미지 업로드 실패: ${uploadError.message}${hint}` },
          { status: 500 }
        );
      }
      imageUrls.push(supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl);
    }

    // 컨텍스트 모드에 따라 가져올 메시지 수 결정
    // 20turns = 40 messages (-1 for current), 40turns = 80, 128k = all
    const limitMap: Record<string, number> = {
      '20turns': 39,
      '40turns': 79,
      '128k': 10000,
    };
    const msgLimit = limitMap[contextMode] ?? 39;

    // images 컬럼 미마이그레이션 DB 폴백 포함 히스토리 조회
    const { data: recentWithImages, error: historyError } = await supabase
      .from('messages')
      .select('role, content, images')
      .order('created_at', { ascending: false })
      .limit(msgLimit);
    let recent: { role: string; content: string; images?: unknown }[] | null = recentWithImages;
    if (historyError) {
      const { data: fallbackRows } = await supabase
        .from('messages')
        .select('role, content')
        .order('created_at', { ascending: false })
        .limit(msgLimit);
      recent = fallbackRows;
    }

    const history: { role: string; content: string; images?: unknown }[] = (recent || [])
      .reverse()
      .filter((m: { content: string }) => m.content !== '[응답 생성 실패]');

    // 히스토리 이미지: 최근 MAX_HISTORY_IMAGES장까지만 URL 블록으로 포함 (나머지는 플레이스홀더)
    let imageBudget = MAX_HISTORY_IMAGES;
    const historyBlockMessages: BlockMessage[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      const urls: string[] = Array.isArray(m.images)
        ? m.images.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      const trimmed = (m.content || '').trim();
      const blocks: Block[] = [];
      if (urls.length > 0 && imageBudget >= urls.length) {
        imageBudget -= urls.length;
        for (const url of urls) {
          blocks.push({ type: 'image', source: { type: 'url', url } });
        }
        if (trimmed) blocks.push({ type: 'text', text: m.content });
      } else if (urls.length > 0) {
        blocks.push({ type: 'text', text: trimmed ? `${IMAGE_PLACEHOLDER}\n${m.content}` : IMAGE_PLACEHOLDER });
      } else if (trimmed) {
        blocks.push({ type: 'text', text: m.content });
      }
      historyBlockMessages.push({ role: m.role as 'user' | 'assistant', blocks });
    }
    historyBlockMessages.reverse();

    // 현재 메시지: 방금 받은 base64 이미지를 그대로 사용 (URL 페치 불필요)
    const currentBlocks: Block[] = userImages.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mediaType as Anthropic.Base64ImageSource['media_type'],
        data: img.data,
      },
    }));
    if (text.trim()) currentBlocks.push({ type: 'text', text });

    const contextMessages = ensureAlternating([
      ...historyBlockMessages,
      { role: 'user', blocks: currentBlocks },
    ]);

    // 마지막 메시지가 user여야 함
    if (contextMessages[contextMessages.length - 1]?.role !== 'user') {
      contextMessages.push({ role: 'user', blocks: currentBlocks });
    }

    const now = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const dateInfo = `현재 날짜/시간: ${now}`;
    const basePrompt = process.env.SYSTEM_PROMPT || '';

    const cacheControl = { type: 'ephemeral', ttl: '1h' } as Anthropic.CacheControlEphemeral;
    const systemBlocks: Anthropic.TextBlockParam[] = basePrompt
      ? [{ type: 'text', text: basePrompt, cache_control: cacheControl }]
      : [];
    const systemParam = systemBlocks.length ? systemBlocks : undefined;

    const MODEL = 'claude-sonnet-4-5-20250929';
    const MAX_INPUT_TOKENS = 180000;
    let finalMessages = contextMessages;

    // 보수적 토큰 추정 (한글 1자 ≈ 최대 1.5토큰, 이미지 1장 ≈ 1600토큰)
    const estimateTokens = (msgs: BlockMessage[]) => {
      let est = basePrompt.length * 1.5;
      for (const m of msgs) {
        for (const b of m.blocks) {
          est += b.type === 'text' ? b.text.length * 1.5 : 1600;
        }
      }
      return est;
    };

    // 앞쪽(오래된) 메시지 제거, 첫 메시지가 user가 되도록 보정
    const dropOldest = (msgs: BlockMessage[], dropCount: number): BlockMessage[] => {
      let next = msgs.slice(Math.min(dropCount, msgs.length - 1));
      if (next.length > 1 && next[0]?.role !== 'user') {
        next = next.slice(1);
      }
      return next;
    };

    // 모든 컨텍스트 모드에서: 추정치가 임계치를 넘으면 실제 토큰을 세서 초과분 제거
    if (estimateTokens(finalMessages) > MAX_INPUT_TOKENS * 0.7) {
      try {
        const countTokens = () =>
          anthropic.messages.countTokens({
            model: MODEL,
            system: systemParam,
            messages: finalMessages.map((m) => ({ role: m.role, content: m.blocks })),
          });
        let tokens = (await countTokens()).input_tokens;

        while (tokens > MAX_INPUT_TOKENS && finalMessages.length > 2) {
          const ratio = MAX_INPUT_TOKENS / tokens;
          finalMessages = dropOldest(
            finalMessages,
            Math.max(2, Math.ceil(finalMessages.length * (1 - ratio)) + 4)
          );
          tokens = (await countTokens()).input_tokens;
        }
      } catch (countError) {
        // countTokens 실패(예: URL 이미지 페치 불가) → 추정치 기반으로 트리밍
        console.error('[count-tokens] 실패, 추정치 기반 트리밍:', countError);
        while (estimateTokens(finalMessages) > MAX_INPUT_TOKENS && finalMessages.length > 2) {
          finalMessages = dropOldest(
            finalMessages,
            Math.max(2, Math.ceil(finalMessages.length * 0.3))
          );
        }
      }
    }

    const runClaude = (apiMessages: Anthropic.MessageParam[]) =>
      anthropic.messages
        .stream({
          model: MODEL,
          max_tokens: 64000,
          system: systemParam,
          messages: apiMessages,
        }, {
          headers: { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' },
        })
        .finalMessage();

    // 단계적 복구 재시도:
    //  1) prompt too long → 오래된 메시지 30% 제거 후 재시도
    //  2) 히스토리 URL 이미지 페치 실패 → 이미지 제외 후 재시도
    let response: Anthropic.Message | null = null;
    let attemptMessages = finalMessages;
    let urlImagesStripped = false;

    for (let attempt = 0; attempt < 6 && !response; attempt++) {
      try {
        response = await runClaude(toApiMessages(attemptMessages, dateInfo, cacheControl));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/prompt is too long/i.test(msg)) {
          if (attemptMessages.length <= 2) {
            throw new Error(
              '메시지(첨부 포함)가 너무 깁니다. 내용을 줄이거나 이미지 수를 줄여주세요.'
            );
          }
          console.error('[claude-retry] 컨텍스트 초과 → 오래된 메시지 제거 후 재시도');
          attemptMessages = dropOldest(
            attemptMessages,
            Math.max(2, Math.ceil(attemptMessages.length * 0.3))
          );
          continue;
        }
        const hasUrlImages = attemptMessages.some((m) =>
          m.blocks.some((b) => b.type === 'image' && b.source.type === 'url')
        );
        if (!urlImagesStripped && hasUrlImages) {
          urlImagesStripped = true;
          console.error('[claude-retry] 히스토리 이미지 제외 후 재시도:', err);
          attemptMessages = stripUrlImages(attemptMessages);
          continue;
        }
        throw err;
      }
    }

    if (!response) {
      throw new Error('컨텍스트가 너무 커서 응답을 생성하지 못했습니다. 컨텍스트 모드를 낮춰주세요.');
    }

    const usage = response.usage;
    console.log('[prompt-cache]', {
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      input: usage.input_tokens,
      output: usage.output_tokens,
    });

    const assistantContent =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // 두 메시지 저장 (images 키는 이미지가 있을 때만 포함 → 미마이그레이션 DB와 호환)
    const userRow: { role: string; content: string; images?: string[] } = {
      role: 'user',
      content: text,
    };
    if (imageUrls.length > 0) userRow.images = imageUrls;

    const { error: insertError } = await supabase.from('messages').insert([
      userRow,
      { role: 'assistant', content: assistantContent },
    ]);

    if (insertError) {
      console.error('[db-insert]', insertError);
      const hint = /images/i.test(insertError.message)
        ? " — Supabase SQL Editor에서 'ALTER TABLE messages ADD COLUMN images JSONB;'를 실행해주세요."
        : '';
      return NextResponse.json({
        content: assistantContent,
        warning: `응답은 생성됐지만 대화 저장에 실패했습니다: ${insertError.message}${hint}`,
      });
    }

    return NextResponse.json({ content: assistantContent });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
