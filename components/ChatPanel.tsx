"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "dd-chat";

const SUGGESTIONS = [
  "Which 3 accounts need attention most this week, and why?",
  "Where are flows underperforming campaigns?",
  "Any spam or bounce risks I should worry about?",
  "Which accounts are overdue for an audit?",
];

// Minimal markdown: headings, bullets, numbered lists, **bold**, `code`, simple tables
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.92em" }}>{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function Markdown({ text, tok }: { text: string; tok: Record<string, string> }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if (!cells.every(c => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <div key={`t${i}`} style={{ overflowX: "auto", margin: "6px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "12px", width: "100%" }}>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => {
                    const Cell = ri === 0 ? "th" : "td";
                    return <Cell key={ci} style={{ border: `1px solid ${tok["--card-border"]}`, padding: "4px 6px", textAlign: "left", fontWeight: ri === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{inline(c)}</Cell>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)/);
    const b = line.match(/^\s*[-*]\s+(.*)/);
    const n = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (h) out.push(<div key={i} style={{ fontWeight: 700, margin: "10px 0 4px" }}>{inline(h[1])}</div>);
    else if (b) out.push(<div key={i} style={{ display: "flex", gap: "6px", paddingLeft: "4px" }}><span>•</span><span>{inline(b[1])}</span></div>);
    else if (n) out.push(<div key={i} style={{ display: "flex", gap: "6px", paddingLeft: "4px" }}><span>{n[1]}.</span><span>{inline(n[2])}</span></div>);
    else if (line.trim() === "") out.push(<div key={i} style={{ height: "6px" }} />);
    else out.push(<div key={i}>{inline(line)}</div>);
    i++;
  }
  return <>{out}</>;
}

export default function ChatPanel({ tok, days }: { tok: Record<string, string>; days: number }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (busy) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages, busy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, focusDays: days }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Request failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages([...next, { role: "assistant", content: `_Error: ${(err as Error).message}_` }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const border = `1px solid ${tok["--card-border"]}`;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{ position: "fixed", right: "20px", bottom: "20px", zIndex: 60, padding: "11px 18px", borderRadius: "999px", background: tok["--accent"], color: "#fff", border: "none", fontSize: "14px", fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.35)" }}
        >
          Ask AI
        </button>
      )}

      {open && (
        <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 100vw)", zIndex: 70, background: tok["--surface"], borderLeft: border, display: "flex", flexDirection: "column", boxShadow: "-8px 0 30px rgba(0,0,0,0.35)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 16px", borderBottom: border }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "15px" }}>Ask AI</div>
              <div style={{ fontSize: "11px", color: tok["--text-dim"] }}>Sees all accounts · 7/30/90-day data · Postmaster</div>
            </div>
            {messages.length > 0 && (
              <button onClick={() => { abortRef.current?.abort(); setMessages([]); }} style={{ padding: "5px 10px", borderRadius: "6px", background: "transparent", border, color: tok["--text-secondary"], fontSize: "12px", cursor: "pointer" }}>New chat</button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ padding: "4px 9px", borderRadius: "6px", background: "transparent", border, color: tok["--text-secondary"], fontSize: "14px", cursor: "pointer" }}>✕</button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "13px", color: tok["--text-secondary"], marginBottom: "4px" }}>Ask about any account, compare clients, or plan next steps.</div>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)} style={{ textAlign: "left", padding: "10px 12px", borderRadius: "8px", background: tok["--card"], border, color: tok["--text-primary"], fontSize: "13px", cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "stretch",
                maxWidth: m.role === "user" ? "85%" : "100%",
                padding: m.role === "user" ? "9px 12px" : "2px 0",
                borderRadius: "10px",
                background: m.role === "user" ? tok["--accent-dim"] : "transparent",
                border: m.role === "user" ? `1px solid ${tok["--accent"]}33` : "none",
                fontSize: "13.5px", lineHeight: 1.55, color: tok["--text-primary"], wordBreak: "break-word",
              }}>
                {m.role === "user" ? m.content : m.content ? <Markdown text={m.content} tok={tok} /> : <span style={{ color: tok["--text-dim"] }}>Thinking…</span>}
              </div>
            ))}
          </div>

          <form onSubmit={e => { e.preventDefault(); send(input); }} style={{ padding: "12px 16px 16px", borderTop: border, display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Ask about your accounts…"
              rows={2}
              style={{ flex: 1, resize: "none", padding: "9px 11px", borderRadius: "8px", background: tok["--card"], border, color: tok["--text-primary"], fontSize: "13.5px", fontFamily: "inherit", outline: "none" }}
            />
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} style={{ padding: "9px 14px", borderRadius: "8px", background: "transparent", border, color: tok["--text-secondary"], fontSize: "13px", cursor: "pointer" }}>Stop</button>
            ) : (
              <button type="submit" disabled={!input.trim()} style={{ padding: "9px 14px", borderRadius: "8px", background: tok["--accent"], border: "none", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: input.trim() ? "pointer" : "default", opacity: input.trim() ? 1 : 0.5 }}>Send</button>
            )}
          </form>
        </aside>
      )}
    </>
  );
}
