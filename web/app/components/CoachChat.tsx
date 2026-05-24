import { useRef, useState } from "react";
import Markdown from "./Markdown";

type Msg = { role: "user" | "assistant"; content: string };

export default function CoachChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    const next = [...msgs, { role: "user", content: text } as Msg];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
        scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
      }
    } catch (err) {
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: `[error: ${(err as Error).message}]` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {msgs.length > 0 && (
        <div ref={scrollRef} className="mb-3 max-h-96 space-y-4 overflow-y-auto pr-1">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="text-right text-sm text-[var(--color-gold)]">
                {m.content}
              </p>
            ) : (
              <div key={i} className="text-sm">
                {m.content ? <Markdown className="prose-chat">{m.content}</Markdown> : <span className="text-[var(--color-muted)]">…</span>}
              </div>
            )
          )}
        </div>
      )}
      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. How do I stop doubting between sessions?"
          className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
