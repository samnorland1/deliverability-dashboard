"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Hardcoded to match main dashboard dark theme exactly
const T = {
  bg: "#0f0f0f",
  surface: "#1a1a1a",
  card: "#1a1a1a",
  border: "#2e2e2e",
  accent: "#3b82f6",
  positive: "#22c55e",
  positiveDim: "rgba(34,197,94,0.1)",
  negative: "#ef4444",
  negativeDim: "rgba(239,68,68,0.1)",
  textPrimary: "#f5f5f5",
  textSecondary: "#c0c0c0",
  textDim: "#737373",
  fontUi: '"Inter", system-ui, sans-serif',
  fontMono: 'ui-monospace, "SF Mono", monospace',
};

type Client = {
  id: string;
  name: string;
  api_key_masked: string;
  sending_domain: string | null;
  created_at: string;
};

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sendingDomain, setSendingDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<string | null>(null); // client id being edited
  const [editDomainValue, setEditDomainValue] = useState("");

  async function fetchClients() {
    const res = await fetch("/api/clients");
    setClients(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchClients(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, api_key: apiKey, sending_domain: sendingDomain }),
    });
    if (res.ok) {
      setName(""); setApiKey(""); setSendingDomain("");
      fetchClients();
    } else {
      const d = await res.json();
      setAddError(d.error ?? "Failed to add");
    }
    setAdding(false);
  }

  async function handleDelete(id: string, clientName: string) {
    if (!confirm(`Remove ${clientName}? All stored metrics will be deleted.`)) return;
    setDeletingId(id);
    await fetch("/api/clients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchClients();
    setDeletingId(null);
  }

  async function handleSaveDomain(id: string) {
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, sending_domain: editDomainValue }),
    });
    setEditingDomain(null);
    fetchClients();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync");
      const d = await res.json();
      if (!res.ok) {
        setSyncMsg({ text: d.error ?? "Sync failed", ok: false });
      } else {
        const ok = d.results?.filter((r: { status: string }) => r.status === "ok").length ?? 0;
        const total = d.results?.length ?? 0;
        setSyncMsg({ text: `Synced ${ok}/${total} accounts`, ok: ok > 0 || total === 0 });
      }
    } catch {
      setSyncMsg({ text: "Sync failed", ok: false });
    }
    setSyncing(false);
  }

  return (
    <>
      <style>{`
        .admin-input { outline: none; transition: border-color 0.15s; }
        .admin-input:focus { border-color: ${T.accent} !important; }
        .remove-btn:hover:not(:disabled) { background: ${T.negativeDim} !important; }
        @media (max-width: 600px) {
          .form-grid { grid-template-columns: 1fr !important; }
          .table-hide { display: none !important; }
          .admin-header { padding: 0 16px !important; }
          .admin-main { padding: 20px 16px 60px !important; }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, color: T.textPrimary, fontFamily: T.fontUi }}>
        <div style={{ height: "2px", background: `linear-gradient(90deg, ${T.accent}, transparent)` }} />

        {/* Header */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(15,15,15,0.96)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${T.border}`,
        }}>
          <div className="admin-header" style={{
            maxWidth: "860px", margin: "0 auto", padding: "0 24px",
            height: "54px", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="Email Evolution" style={{ height: "28px", width: "auto", objectFit: "contain" }} />
              </Link>
              <span style={{ color: T.textDim, fontSize: "14px" }}>/</span>
              <span style={{ fontSize: "14px", color: T.textSecondary }}>Accounts</span>
            </div>

            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: "7px 16px", borderRadius: "7px",
                background: syncing ? T.surface : T.accent,
                border: `1px solid ${syncing ? T.border : "transparent"}`,
                color: syncing ? T.textSecondary : "white",
                fontSize: "13px", fontWeight: 600, fontFamily: T.fontUi,
                cursor: syncing ? "not-allowed" : "pointer",
                transition: "all 0.15s",
              }}
            >
              {syncing ? "Syncing…" : "Sync All"}
            </button>
          </div>
        </header>

        <main className="admin-main" style={{ maxWidth: "860px", margin: "0 auto", padding: "28px 24px 64px" }}>

          {syncMsg && (
            <div style={{
              marginBottom: "20px", padding: "11px 14px", borderRadius: "8px",
              background: syncMsg.ok ? T.positiveDim : T.negativeDim,
              border: `1px solid ${syncMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              color: syncMsg.ok ? T.positive : T.negative,
              fontSize: "13px", fontFamily: T.fontUi,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              {syncMsg.text}
              <button onClick={() => setSyncMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 0 0 12px" }}>×</button>
            </div>
          )}

          {/* Add Account */}
          <section style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: "10px", padding: "20px", marginBottom: "16px",
          }}>
            <h2 style={{ fontSize: "14px", fontWeight: 600, color: T.textPrimary, marginBottom: "16px" }}>
              Add Account
            </h2>

            <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }}>
                    Client Name
                  </label>
                  <input
                    className="admin-input"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Acme Co."
                    required
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: "7px",
                      background: T.surface, border: `1px solid ${T.border}`,
                      color: T.textPrimary, fontSize: "14px", fontFamily: T.fontUi,
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }}>
                    Klaviyo Private API Key
                  </label>
                  <input
                    className="admin-input"
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="pk_live_••••••••••"
                    required
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: "7px",
                      background: T.surface, border: `1px solid ${T.border}`,
                      color: T.textPrimary, fontSize: "14px", fontFamily: T.fontMono,
                    }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }}>
                  Sending Domain <span style={{ color: T.textDim, fontWeight: 400 }}>(optional — for Google Postmaster reputation)</span>
                </label>
                <input
                  className="admin-input"
                  type="text"
                  value={sendingDomain}
                  onChange={e => setSendingDomain(e.target.value)}
                  placeholder="example.com"
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: "7px",
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.textPrimary, fontSize: "14px", fontFamily: T.fontMono,
                  }}
                />
              </div>

              {addError && (
                <p style={{ fontSize: "13px", color: T.negative }}>{addError}</p>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={adding || !name || !apiKey}
                  style={{
                    padding: "9px 20px", borderRadius: "7px",
                    background: T.accent, border: "none",
                    color: "white", fontSize: "13px", fontWeight: 600, fontFamily: T.fontUi,
                    cursor: adding || !name || !apiKey ? "not-allowed" : "pointer",
                    opacity: adding || !name || !apiKey ? 0.5 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  {adding ? "Adding…" : "Add Account"}
                </button>
              </div>
            </form>
          </section>

          {/* Connected Accounts */}
          <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{
              padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <h2 style={{ fontSize: "14px", fontWeight: 600, color: T.textPrimary }}>Connected Accounts</h2>
              <span style={{ fontSize: "12px", color: T.textDim, fontFamily: T.fontMono }}>{clients.length} total</span>
            </div>

            {loading ? (
              <div style={{ padding: "32px", textAlign: "center", color: T.textDim, fontSize: "13px" }}>Loading…</div>
            ) : clients.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: T.textDim, fontSize: "13px" }}>No accounts yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.01)" }}>
                    {[
                      { label: "Client", hide: false },
                      { label: "Sending Domain", hide: false },
                      { label: "API Key", hide: true },
                      { label: "Added", hide: true },
                      { label: "", hide: false },
                    ].map(h => (
                      <th key={h.label} className={h.hide ? "table-hide" : ""} style={{
                        padding: "9px 20px", textAlign: "left",
                        fontSize: "11px", fontWeight: 500, color: T.textDim,
                        borderBottom: `1px solid ${T.border}`,
                      }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => (
                    <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? `1px solid ${T.border}` : "none" }}>
                      <td style={{ padding: "12px 20px", fontSize: "14px", fontWeight: 600, color: T.textPrimary }}>{c.name}</td>
                      <td style={{ padding: "8px 20px" }}>
                        {editingDomain === c.id ? (
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <input
                              className="admin-input"
                              autoFocus
                              type="text"
                              value={editDomainValue}
                              onChange={e => setEditDomainValue(e.target.value)}
                              placeholder="example.com"
                              onKeyDown={e => { if (e.key === "Enter") handleSaveDomain(c.id); if (e.key === "Escape") setEditingDomain(null); }}
                              style={{ padding: "5px 9px", borderRadius: "6px", background: T.surface, border: `1px solid ${T.border}`, color: T.textPrimary, fontSize: "12px", fontFamily: T.fontMono, width: "160px" }}
                            />
                            <button onClick={() => handleSaveDomain(c.id)} style={{ padding: "4px 10px", borderRadius: "5px", background: T.accent, border: "none", color: "white", fontSize: "12px", cursor: "pointer" }}>Save</button>
                            <button onClick={() => setEditingDomain(null)} style={{ padding: "4px 8px", borderRadius: "5px", background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, fontSize: "12px", cursor: "pointer" }}>✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingDomain(c.id); setEditDomainValue(c.sending_domain ?? ""); }}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontFamily: T.fontMono, fontSize: "12px", color: c.sending_domain ? T.textSecondary : T.textDim }}
                          >
                            {c.sending_domain ?? <span style={{ fontStyle: "italic" }}>click to set</span>}
                          </button>
                        )}
                      </td>
                      <td className="table-hide" style={{ padding: "12px 20px", fontSize: "12px", color: T.textDim, fontFamily: T.fontMono }}>{c.api_key_masked}</td>
                      <td className="table-hide" style={{ padding: "12px 20px", fontSize: "12px", color: T.textDim }}>
                        {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td style={{ padding: "12px 20px", textAlign: "right" }}>
                        <button
                          className="remove-btn"
                          onClick={() => handleDelete(c.id, c.name)}
                          disabled={deletingId === c.id}
                          style={{
                            padding: "5px 12px", borderRadius: "6px",
                            background: "transparent", border: `1px solid rgba(239,68,68,0.25)`,
                            color: T.negative, fontSize: "12px", cursor: "pointer",
                            opacity: deletingId === c.id ? 0.5 : 1,
                            transition: "background 0.15s",
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
    </>
  );
}
