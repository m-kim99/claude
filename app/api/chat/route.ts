import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@/lib/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function ensureAlternating(messages: { role: string; content: string }[]) {
  const result: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n\n' + msg.content;
    } else {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { content, contextMode = '20turns' } = await req.json();
    if (!content?.trim()) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 컨텍스트 모드에 따라 가져올 메시지 수 결정
    // 20turns = 40 messages (-1 for current), 40turns = 80, 128k = all
    const limitMap: Record<string, number> = {
      '20turns': 39,
      '40turns': 79,
      '128k': 10000,
    };
    const msgLimit = limitMap[contextMode] ?? 39;

    const query = supabase
      .from('messages')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(msgLimit);

    const { data: recent } = await query;

    const contextMessages = ensureAlternating([
      ...(recent || [])
        .reverse()
        .filter((m) => m.content !== '[응답 생성 실패]'),
      { role: 'user', content },
    ]);

    // 마지막 메시지가 user여야 함
    if (contextMessages[contextMessages.length - 1]?.role !== 'user') {
      contextMessages.push({ role: 'user', content });
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

    const systemBlocks: Anthropic.TextBlockParam[] = basePrompt
      ? [{ type: 'text', text: basePrompt, cache_control: { type: 'ephemeral' } }]
      : [];
    const systemParam = systemBlocks.length ? systemBlocks : undefined;

    const MODEL = 'claude-sonnet-4-5-20250929';
    const MAX_INPUT_TOKENS = 180000;
    let finalMessages = contextMessages;

    if (contextMode === '128k' && contextMessages.length > 80) {
      let tokens = (await anthropic.messages.countTokens({
        model: MODEL, system: systemParam, messages: finalMessages,
      })).input_tokens;

      while (tokens > MAX_INPUT_TOKENS && finalMessages.length > 2) {
        const ratio = MAX_INPUT_TOKENS / tokens;
        const dropCount = Math.max(2, Math.ceil(finalMessages.length * (1 - ratio)) + 4);
        finalMessages = finalMessages.slice(dropCount);
        if (finalMessages[0]?.role !== 'user') {
          finalMessages = finalMessages.slice(1);
        }
        tokens = (await anthropic.messages.countTokens({
          model: MODEL, system: systemParam, messages: finalMessages,
        })).input_tokens;
      }
    }

    const lastIndex = finalMessages.length - 1;
    const cacheIndex = finalMessages.length - 2;
    const apiMessages: Anthropic.MessageParam[] = finalMessages.map((m, i) => {
      const text = i === lastIndex ? `${m.content}\n\n${dateInfo}` : m.content;
      if (i === cacheIndex) {
        return {
          role: m.role,
          content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
        };
      }
      return { role: m.role, content: text };
    });

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: systemParam,
      messages: apiMessages,
    });
    const response = await stream.finalMessage();

    const usage = response.usage;
    console.log('[prompt-cache]', {
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      input: usage.input_tokens,
      output: usage.output_tokens,
    });

    const assistantContent =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // 두 메시지 저장
    await supabase.from('messages').insert([
      { role: 'user', content },
      { role: 'assistant', content: assistantContent },
    ]);

    return NextResponse.json({ content: assistantContent });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
