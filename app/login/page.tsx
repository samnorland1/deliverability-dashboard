"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/");
    } else {
      setError("Incorrect password");
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        .pw-input { outline: none; }
        .pw-input::placeholder { color: var(--text-dim); }
        .pw-input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .btn-primary:hover:not(:disabled) { background: #2563eb !important; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}>
        <div style={{
          width: "100%",
          maxWidth: "400px",
          animation: "fadeIn 0.3s ease forwards",
        }}>
          {/* Logo mark */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "var(--accent)",
              marginBottom: "20px",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={{
              fontFamily: "var(--font-heading)",
              fontSize: "24px",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: "6px",
              letterSpacing: "-0.02em",
            }}>
              Deliverability Dashboard
            </h1>
            <p style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}>
              Klaviyo performance monitoring across all your client accounts.
            </p>
          </div>

          {/* Form */}
          <div style={{
            background: "var(--card)",
            border: "1px solid var(--card-border)",
            borderRadius: "12px",
            padding: "24px",
          }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                }}>
                  Password
                </label>
                <input
                  className="pw-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--card-border)",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    fontFamily: "var(--font-ui)",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                />
              </div>

              {error && (
                <div style={{
                  padding: "10px 14px",
                  borderRadius: "7px",
                  background: "var(--negative-dim)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  fontSize: "13px",
                  color: "var(--negative)",
                }}>
                  {error}
                </div>
              )}

              <button
                className="btn-primary"
                type="submit"
                disabled={loading || !password}
                style={{
                  width: "100%",
                  padding: "11px",
                  borderRadius: "8px",
                  background: "var(--accent)",
                  border: "none",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: 600,
                  fontFamily: "var(--font-ui)",
                  cursor: loading || !password ? "not-allowed" : "pointer",
                  opacity: loading || !password ? 0.5 : 1,
                  transition: "background 0.15s, opacity 0.15s",
                }}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
