import { useEffect, useRef, useState } from "react";
import { postChudChat, type ChudChatTurn } from "./api";

type Props = {
  chatMessages: ChudChatTurn[];
  chatLlmConfigured: boolean;
  chatSessionId: string;
  onRefresh: () => void;
};

export function ChudPanel({ chatMessages, chatLlmConfigured, chatSessionId, onRefresh }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prevLenRef = useRef(0);

  function scrollThreadToBottom(): void {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function onThreadScroll(): void {
    const el = threadRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 80;
  }

  useEffect(() => {
    const grew = chatMessages.length > prevLenRef.current;
    prevLenRef.current = chatMessages.length;
    if (!grew || !stickToBottomRef.current) return;
    const id = window.setTimeout(() => scrollThreadToBottom(), 0);
    return () => window.clearTimeout(id);
  }, [chatMessages]);

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t || sending) return;
    setSending(true);
    setErr(null);
    stickToBottomRef.current = true;
    try {
      await postChudChat(t, false, chatSessionId);
      setDraft("");
      onRefresh();
      window.setTimeout(() => scrollThreadToBottom(), 100);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel chud-panel">
      <div className="panel-title">[ talk to chud ]</div>

      {err && (
        <p className="coach-err" role="alert">
          {err}
        </p>
      )}

      {!chatLlmConfigured && (
        <p className="chud-chat-warn">chat is currently offline. configure chud chat in backend settings and restart.</p>
      )}
      {chatMessages.length > 0 && (
        <div
          className="chat-thread"
          ref={threadRef}
          onScroll={onThreadScroll}
          aria-label="talk to chud"
        >
          {chatMessages.map((m) => (
            <div key={m.id} className={`chat-row ${m.role === "user" ? "chat-row-user" : "chat-row-chud"}`}>
              <span className="chat-meta">{m.role === "user" ? "you" : "chud"} · {new Date(m.at).toLocaleString()}</span>
              <div className={`chat-bubble ${m.role === "user" ? "chat-bubble-user" : "chat-bubble-chud"}`}>
                <p>{m.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="coach-form" onSubmit={sendChat}>
        <textarea
          className="coach-input chud-input"
          rows={4}
          placeholder="ask the chud anything..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          disabled={sending}
        />
        <button type="submit" className="coach-send" disabled={sending || !draft.trim() || !chatLlmConfigured}>
          {sending ? "chud is typing…" : "send"}
        </button>
      </form>
    </div>
  );
}
