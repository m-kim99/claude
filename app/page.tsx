'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
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

// ─── Memoized Message Component (개별 메시지 리렌더 방지) ────────
const MessageItem = memo(function MessageItem({ msg }: { msg: Message }) {
  const [copied, setCopied] = useState(false);

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
          className="max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words rounded-br-sm"
          style={{ backgroundColor: '#F0EBE5', color: '#2d2a26' }}
        >
          {msg.content}
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
    </div>
  );
});

// ─── Isolated Input Area (입력 state가 메시지 목록 리렌더 유발 방지) ──
function InputArea({ loading, onSend }: { loading: boolean; onSend: (text: string) => void }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#FCFAF8' }}>
      <div className="max-w-3xl mx-auto flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지 입력..."
          rows={1}
          disabled={loading}
          className="flex-1 bg-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none disabled:bg-gray-50 transition-all overflow-hidden"
          style={{ border: '1.5px solid #EEEDEC', minHeight: '42px', maxHeight: '160px', fontSize: '16px' }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 text-white"
          style={{ backgroundColor: '#b8a68e' }}
        >
          전송
        </button>
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
  const autoScrollRef = useRef(true);
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

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (prevScrollHeightRef.current !== null) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    } else if (autoScrollRef.current) {
      if (container.scrollHeight > container.clientHeight) {
        container.scrollTop = container.scrollHeight;
        if (!isInitializedRef.current) {
          isInitializedRef.current = true;
        }
      }
      autoScrollRef.current = false;
    }
  }, [messages]);

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

    if (!isInitializedRef.current || loadingMore || !hasMore) return;
    if (container.scrollTop < 80) {
      loadOlderMessages();
    }
  }, [loadingMore, hasMore, loadOlderMessages]);

  const sendMessage = async (userContent: string) => {
    if (loading) return;
    setError('');
    setLoading(true);
    autoScrollRef.current = true;

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: userContent, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userContent, contextMode }),
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

      await loadHistory();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-x-hidden" style={{ backgroundColor: '#FCFAF8' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#FCFAF8' }}>
        <div>
          <h1 className="font-semibold text-gray-800 text-base">Chat</h1>
          <p className="text-xs text-gray-400 font-mono">claude-sonnet-4-5-20250929</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={contextMode}
            onChange={(e) => setContextMode(e.target.value as ContextMode)}
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
          <div className="max-w-3xl mx-auto space-y-5">
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
