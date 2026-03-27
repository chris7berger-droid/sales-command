import { useNavigate } from "react-router-dom";
import { C, F, GLOBAL_CSS } from "../lib/tokens";
import { SalesCommandMark } from "../components/Logo";

export default function CheckoutPage() {
  const navigate = useNavigate();

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: "100vh", background: C.linen, display: "flex", flexDirection: "column" }}>

        {/* Nav */}
        <nav style={{
          background: C.dark, padding: "0 40px", height: 64,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          <div onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <SalesCommandMark size={32} />
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff" }}>
              Sales <span style={{ color: C.teal }}>Command</span>
            </div>
          </div>
          <button onClick={() => navigate("/")} style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", background: "none", border: "none", cursor: "pointer" }}>
            &larr; Back
          </button>
        </nav>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>

            <div style={{
              background: C.dark, borderRadius: 16, padding: "48px 40px",
              border: `2px solid ${C.teal}`, boxShadow: "0 8px 40px rgba(28,24,20,0.25)",
              marginBottom: 32,
            }}>
              <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.teal, marginBottom: 8 }}>Pro Plan</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4, marginBottom: 12 }}>
                <span style={{ fontFamily: F.display, fontSize: 52, fontWeight: 800, color: "#fff" }}>$99</span>
                <span style={{ fontFamily: F.ui, fontSize: 14, color: "rgba(255,255,255,0.4)" }}>/month</span>
              </div>
              <div style={{ fontFamily: F.body, fontSize: 14, lineHeight: 1.8, color: "rgba(255,255,255,0.5)", marginBottom: 32 }}>
                Unlimited users, proposals, invoices, QuickBooks sync,
                Stripe payments, and e-signatures. Everything included.
              </div>

              <div style={{
                height: 1, background: "rgba(255,255,255,0.1)", margin: "0 0 32px",
              }} />

              <div style={{
                background: "rgba(48,207,172,0.08)", border: `1px solid ${C.tealBorder}`,
                borderRadius: 12, padding: "24px 20px",
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
                <div style={{
                  fontFamily: F.display, fontSize: 18, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  color: "#fff", marginBottom: 8,
                }}>
                  Coming Soon
                </div>
                <p style={{
                  fontFamily: F.body, fontSize: 14, lineHeight: 1.6,
                  color: "rgba(255,255,255,0.5)", margin: 0,
                }}>
                  Online checkout is being set up. Contact us directly to get started today.
                </p>
              </div>
            </div>

            <p style={{ fontFamily: F.body, fontSize: 15, color: C.textMuted, marginBottom: 24 }}>
              Ready to get started? Reach out and we'll get you set up.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => navigate("/login")}
                style={{
                  fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", padding: "12px 32px", borderRadius: 8,
                  background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
                  cursor: "pointer",
                }}
              >
                Sign In
              </button>
              <button
                onClick={() => navigate("/")}
                style={{
                  fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", padding: "12px 32px", borderRadius: 8,
                  background: C.linen, color: C.dark, border: `2px solid ${C.teal}`,
                  cursor: "pointer",
                }}
              >
                Back to Home
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
