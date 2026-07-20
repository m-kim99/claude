'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[] | null;
  created_at: string;
}

type ContextMode = '20turns' | '40turns' | '128k';
const CONTEXT_OPTIONS: { value: ContextMode; label: string }[] = [
  { value: '20turns', label: '최근 20턴' },
  { value: '40turns', label: '최근 40턴' },
  { value: '128k', label: '128k 전체' },
];

// ─── Markdown components (모듈 레벨 상수 — 매 렌더마다 재생성 방지) ───
const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-3">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-3">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <pre className="bg-black/5 rounded-lg p-3 my-3 overflow-x-auto text-xs"><code>{children}</code></pre>
    ) : (
      <code className="bg-black/5 rounded px-1 py-0.5 text-xs">{children}</code>
    );
  },
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-2">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-gray-400 pl-3 italic my-2">{children}</blockquote>,
};

const remarkPlugins = [remarkGfm];

// ─── 이미지 첨부 설정/유틸 ──────────────────────────────────────
const MAX_IMAGES = 4;
const MAX_FILE_MB = 20;
const MAX_IMAGE_DIM = 1568; // Claude 권장 최대 해상도

interface OutgoingImage {
  dataUrl: string;
  data: string;
  mediaType: string;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다'));
    };
    img.src = url;
  });
}

// 브라우저에서 리사이즈 + JPEG 변환 → 업로드 용량/토큰 최적화
async function fileToJpegDataUrl(file: File): Promise<string> {
  const img = await loadImageFromFile(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context 생성 실패');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

// ─── Memoized Message Component (개별 메시지 리렌더 방지) ────────
const MessageItem = memo(function MessageItem({ msg }: { msg: Message }) {
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyIcon = copied ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  );

  return (
    <div className={`group relative flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {msg.role === 'user' && (
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity self-start mt-1 mr-2 p-1.5 rounded-md hover:bg-black/5 text-gray-400 hover:text-gray-600 flex-shrink-0"
          title="복사"
        >
          {copyIcon}
        </button>
      )}

      {msg.role === 'user' ? (
        <div
          className="max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words rounded-br-sm"
          style={{ backgroundColor: '#F0EBE5', color: '#2d2a26' }}
        >
          {msg.images && msg.images.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${msg.content ? 'mb-2' : ''}`}>
              {msg.images.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt={`첨부 이미지 ${i + 1}`}
                  loading="lazy"
                  onClick={() => setLightbox(url)}
                  className="max-h-48 max-w-full rounded-lg cursor-zoom-in"
                />
              ))}
            </div>
          )}
          {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
        </div>
      ) : (
        <div className="max-w-[85%] text-sm leading-relaxed text-gray-800">
          <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
      )}

      {msg.role === 'assistant' && (
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity self-end mb-0.5 ml-2 p-1.5 rounded-md hover:bg-black/5 text-gray-400 hover:text-gray-600 flex-shrink-0"
          title="복사"
        >
          {copyIcon}
        </button>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="첨부 이미지 원본" className="max-w-full max-h-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
});

// ─── Isolated Input Area (입력 state가 메시지 목록 리렌더 유발 방지) ──
function InputArea({ loading, onSend }: { loading: boolean; onSend: (text: string, images: OutgoingImage[]) => void }) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ id: string; dataUrl: string }[]>([]);
  const [attachError, setAttachError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setAttachError('');
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        setAttachError('이미지 파일만 첨부할 수 있습니다.');
        return;
      }
      const room = MAX_IMAGES - pending.length;
      if (room <= 0) {
        setAttachError(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
        return;
      }
      if (imageFiles.length > room) {
        setAttachError(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
      }
      const selected = imageFiles.slice(0, room);
      if (selected.some((f) => f.size > MAX_FILE_MB * 1024 * 1024)) {
        setAttachError(`${MAX_FILE_MB}MB 이하의 이미지만 첨부할 수 있습니다.`);
        return;
      }
      setProcessing(true);
      try {
        const converted = await Promise.all(
          selected.map(async (f, i) => ({
            id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
            dataUrl: await fileToJpegDataUrl(f),
          }))
        );
        setPending((prev) => [...prev, ...converted].slice(0, MAX_IMAGES));
      } catch {
        setAttachError('이미지 처리에 실패했습니다. 다른 이미지를 사용해주세요.');
      } finally {
        setProcessing(false);
      }
    },
    [pending.length]
  );

  const handleSend = () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || loading || processing) return;
    const images: OutgoingImage[] = pending.map((p) => {
      const comma = p.dataUrl.indexOf(',');
      const meta = p.dataUrl.slice(0, comma);
      return {
        dataUrl: p.dataUrl,
        data: p.dataUrl.slice(comma + 1),
        mediaType: meta.slice(5, meta.indexOf(';')),
      };
    });
    onSend(text, images);
    setInput('');
    setPending([]);
    setAttachError('');
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  return (
    <div
      className="px-4 py-3"
      style={{ backgroundColor: '#FCFAF8' }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="max-w-3xl mx-auto">
        {attachError && <p className="text-xs text-red-400 mb-1.5 px-1">{attachError}</p>}
        {(pending.length > 0 || processing) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pending.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.dataUrl}
                  alt="첨부 이미지 미리보기"
                  className="w-16 h-16 object-cover rounded-lg"
                  style={{ border: '1.5px solid #EEEDEC' }}
                />
                <button
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-600 hover:bg-gray-800 text-white text-xs leading-none flex items-center justify-center"
                  title="이미지 제거"
                >
                  ×
                </button>
              </div>
            ))}
            {processing && (
              <div
                className="w-16 h-16 rounded-lg flex items-center justify-center"
                style={{ border: '1.5px dashed #d6d3ce' }}
              >
                <span className="text-xs text-gray-400 animate-pulse">···</span>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) addFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || processing}
            className="rounded-xl w-[42px] h-[42px] flex items-center justify-center bg-white text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            style={{ border: '1.5px solid #EEEDEC' }}
            title="이미지 첨부"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={dragging ? '이미지를 여기에 놓으세요' : '메시지 입력...'}
            rows={1}
            disabled={loading}
            className="flex-1 bg-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none disabled:bg-gray-50 transition-all overflow-hidden"
            style={{
              border: dragging ? '1.5px dashed #b8a68e' : '1.5px solid #EEEDEC',
              minHeight: '42px',
              maxHeight: '160px',
              fontSize: '16px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || processing || (!input.trim() && pending.length === 0)}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 text-white"
            style={{ backgroundColor: '#b8a68e' }}
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Page ─────────────────────────────────────────────
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('20turns');
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const stickToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/history?limit=50&t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      autoScrollRef.current = true;
      setMessages(data.messages || []);
      setHasMore(data.hasMore ?? false);
    } catch {
      setError('히스토리 로드 실패');
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const saved = localStorage.getItem('contextMode');
    if (saved === '20turns' || saved === '40turns' || saved === '128k') {
      setContextMode(saved);
    }
  }, []);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (prevScrollHeightRef.current !== null) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
      stickToBottomRef.current = false;
    } else if (autoScrollRef.current) {
      if (container.scrollHeight > container.clientHeight) {
        container.scrollTop = container.scrollHeight;
        if (!isInitializedRef.current) {
          isInitializedRef.current = true;
        }
      }
      autoScrollRef.current = false;
      stickToBottomRef.current = true;
    }
  }, [messages]);

  // 이미지 로드(콘텐츠 높이 증가)뿐 아니라 컨테이너 크기 변화
  // (모바일 주소창/키보드/창 크기)에서도 바닥에 붙은 상태 유지
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const pinToBottom = () => {
      if (stickToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    };

    const observer = new ResizeObserver(pinToBottom);
    observer.observe(content);
    observer.observe(container);

    // iOS 등에서 레이아웃 변화 없이 비주얼 뷰포트만 변하는 경우 대응
    window.visualViewport?.addEventListener('resize', pinToBottom);

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', pinToBottom);
    };
  }, [hasMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    autoScrollRef.current = false;
    const oldestId = messages[0].id;
    prevScrollHeightRef.current = scrollContainerRef.current?.scrollHeight ?? null;
    try {
      const res = await fetch(`/api/history?limit=50&before=${oldestId}&t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if ((data.messages || []).length > 0) {
        setMessages((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore ?? false);
      } else {
        setHasMore(false);
        prevScrollHeightRef.current = null;
      }
    } catch {
      prevScrollHeightRef.current = null;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
    stickToBottomRef.current = distFromBottom < 40;

    if (!isInitializedRef.current || loadingMore || !hasMore) return;
    if (container.scrollTop < 80) {
      loadOlderMessages();
    }
  }, [loadingMore, hasMore, loadOlderMessages]);

  const sendMessage = async (userContent: string, images: OutgoingImage[] = []) => {
    if (loading) return;
    setError('');
    setLoading(true);
    autoScrollRef.current = true;

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: userContent,
        images: images.length > 0 ? images.map((img) => img.dataUrl) : null,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: userContent,
          contextMode,
          images: images.map(({ data, mediaType }) => ({ data, mediaType })),
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '응답 오류');

      autoScrollRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          id: `temp-${Date.now() + 1}`,
          role: 'assistant',
          content: data.content,
          created_at: new Date().toISOString(),
        },
      ]);

      if (data.warning) {
        // 응답은 생성됐지만 DB 저장 실패 → 화면의 임시 메시지 유지
        setError(data.warning);
      } else {
        await loadHistory();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex flex-col h-screen overflow-x-hidden"
      style={{ height: '100dvh', backgroundColor: '#FCFAF8' }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#FCFAF8' }}>
        <div>
          <h1 className="font-semibold text-gray-800 text-base">Chat</h1>
          <p className="text-xs text-gray-400 font-mono">claude-sonnet-4-5-20250929</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={contextMode}
            onChange={(e) => {
              const v = e.target.value as ContextMode;
              setContextMode(v);
              localStorage.setItem('contextMode', v);
            }}
            className="text-xs bg-white rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none cursor-pointer appearance-none"
            style={{ border: '1.5px solid #EEEDEC' }}
          >
            {CONTEXT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-400">{messages.length}개</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <p className="text-4xl">💬</p>
            <p className="text-sm">대화를 시작하세요</p>
          </div>
        ) : (
          <div ref={contentRef} className="max-w-3xl mx-auto space-y-5">
            {loadingMore && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-gray-400">불러오는 중...</span>
              </div>
            )}
            {!hasMore && messages.length > 0 && (
              <div className="flex justify-center py-1">
                <span className="text-xs text-gray-300">— 대화 시작 —</span>
              </div>
            )}
            {messages.map((msg) => (
              <MessageItem key={msg.id} msg={msg} />
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="px-1 py-3">
                  <div className="flex gap-1.5 items-center">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border-t border-red-100 px-4 py-2 text-xs text-red-500">
          ⚠️ {error}
        </div>
      )}

      {showScrollBtn && (
        <div className="flex justify-center pb-1">
          <button
            onClick={() => {
              const container = scrollContainerRef.current;
              if (container) {
                container.scrollTop = container.scrollHeight;
              }
            }}
            className="rounded-full w-8 h-8 flex items-center justify-center bg-white shadow-md border border-gray-200 text-gray-500 hover:text-gray-700 hover:shadow-lg transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      )}

      <InputArea loading={loading} onSend={sendMessage} />
    </div>
  );
}
