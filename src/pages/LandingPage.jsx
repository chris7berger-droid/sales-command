import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, GLOBAL_CSS } from "../lib/tokens";
import { SalesCommandMark } from "../components/Logo";

const FEATURES = [
  { icon: "📋", title: "Call Log & Pipeline", slug: "call-log-pipeline", desc: "Track every inquiry from first call to signed proposal. Never lose a lead again." },
  { icon: "📄", title: "Proposals & E-Sign", slug: "proposals-e-sign", desc: "Build detailed proposals with work type calculators, send for e-signature, and close deals faster." },
  { icon: "💵", title: "Invoicing & Payments", slug: "invoicing-payments", desc: "Generate invoices, collect payments via Stripe, and keep cash flow moving." },
  { icon: "📊", title: "QuickBooks Sync", slug: "quickbooks-sync", desc: "Customers, invoices, and payments sync to QuickBooks automatically. No double entry." },
  { icon: "🏗️", title: "Job Management", slug: "job-management", desc: "Manage jobs, change orders, and work types from one central command center." },
  { icon: "🏆", title: "Sales Dashboards", slug: "sales-dashboards", desc: "Real-time visibility into your sales pipeline, revenue, and team performance." },
];

const STATS = [
  { value: "Zero", label: "Double Entry" },
  { value: "100%", label: "Paperless Proposals" },
  { value: "Real-Time", label: "Pipeline Visibility" },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .lp-fade { animation: fadeUp 0.7s ease-out both; }
        .lp-fade-d1 { animation-delay: 0.1s; }
        .lp-fade-d2 { animation-delay: 0.2s; }
        .lp-fade-d3 { animation-delay: 0.35s; }
        .lp-fade-d4 { animation-delay: 0.5s; }
        .lp-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(48,207,172,0.25) !important; }
        .lp-btn-outline:hover { background: rgba(48,207,172,0.08) !important; }
        .lp-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(28,24,20,0.18) !important; border-color: ${C.teal} !important; }
        .lp-nav-link:hover { color: ${C.teal} !important; }
        @media (max-width: 768px) {
          .lp-hero-grid { flex-direction: column !important; text-align: center !important; }
          .lp-hero-text { align-items: center !important; }
          .lp-features-grid { grid-template-columns: 1fr !important; }
          .lp-stats-row { flex-direction: column !important; gap: 24px !important; }
          .lp-nav-links { display: none !important; }
          .lp-hamburger { display: flex !important; }
          .lp-hero-h1 { font-size: 44px !important; }
          .lp-section { padding: 60px 20px !important; }
          .lp-cta-buttons { flex-direction: column !important; align-items: center !important; }
        }
      `}</style>

      <div style={{ background: C.linen, color: C.textBody, minHeight: "100vh", overflowX: "hidden" }}>

        {/* ── NAV ── */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
          background: "rgba(28,24,20,0.92)", backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${C.darkBorder}`,
          padding: "0 40px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SalesCommandMark size={32} />
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff" }}>
              Sales <span style={{ color: C.teal }}>Command</span>
            </div>
          </div>
          <div className="lp-nav-links" style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <a href="#features" className="lp-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>Features</a>
            <a href="#how-it-works" className="lp-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>How It Works</a>
            <a href="#pricing" className="lp-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>Pricing</a>
            <button
              onClick={() => navigate("/login")}
              style={{
                fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "9px 24px", borderRadius: 8,
                background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                transition: "all 0.2s",
              }}
              className="lp-btn"
            >
              Sign In
            </button>
          </div>
          {/* Hamburger button — hidden on desktop */}
          <button
            className="lp-hamburger"
            onClick={() => setMenuOpen(p => !p)}
            style={{
              display: "none", flexDirection: "column", gap: 5, background: "none",
              border: "none", cursor: "pointer", padding: 6,
            }}
          >
            <span style={{ width: 22, height: 2, background: menuOpen ? C.teal : "#fff", borderRadius: 1, transition: "all 0.2s", transform: menuOpen ? "rotate(45deg) translate(3px,3px)" : "none" }} />
            <span style={{ width: 22, height: 2, background: "#fff", borderRadius: 1, transition: "all 0.2s", opacity: menuOpen ? 0 : 1 }} />
            <span style={{ width: 22, height: 2, background: menuOpen ? C.teal : "#fff", borderRadius: 1, transition: "all 0.2s", transform: menuOpen ? "rotate(-45deg) translate(4px,-4px)" : "none" }} />
          </button>
        </nav>

        {/* ── MOBILE MENU ── */}
        {menuOpen && (
          <div style={{
            position: "fixed", top: 64, left: 0, right: 0, zIndex: 99,
            background: C.dark, borderBottom: `2px solid ${C.teal}`,
            padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16,
            animation: "fadeIn 0.2s ease-out",
          }}>
            <a href="#features" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Features</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>How It Works</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Pricing</a>
            <button
              onClick={() => { setMenuOpen(false); navigate("/login"); }}
              style={{
                fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "12px 24px", borderRadius: 8,
                background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                marginTop: 4,
              }}
            >
              Sign In
            </button>
          </div>
        )}

        {/* ── HERO ── */}
        <section style={{ padding: "140px 40px 80px" }}>
          <div className="lp-hero-grid" style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 60 }}>
            <div className="lp-hero-text" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 24 }}>
              <div className="lp-fade" style={{
                fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em",
                textTransform: "uppercase", color: C.teal, background: C.dark,
                border: `1px solid ${C.tealBorder}`, padding: "6px 16px", borderRadius: 20,
              }}>
                Built for SubContractors
              </div>
              <h1 className="lp-fade lp-fade-d1 lp-hero-h1" style={{
                fontFamily: F.display, fontSize: 56, fontWeight: 800, lineHeight: 1.05,
                letterSpacing: "0.02em", textTransform: "uppercase", margin: 0, color: C.textHead,
              }}>
                Run Your Sales.<br />
                <span style={{ color: C.teal, WebkitTextStroke: `1.5px ${C.dark}` }}>Command</span> Your Revenue.
              </h1>
              <p className="lp-fade lp-fade-d2" style={{
                fontFamily: F.body, fontSize: 17, lineHeight: 1.65, color: C.textMuted,
                maxWidth: 480,
              }}>
                The software you've been using wasn't designed by a subcontractor.
                Sales Command was. One system for leads, proposals, invoices, and
                QuickBooks — built for the way you actually work. No complexity.
                No learning curve. Just results.
              </p>
              <div className="lp-fade lp-fade-d3 lp-cta-buttons" style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <button
                  onClick={() => navigate("/login")}
                  className="lp-btn"
                  style={{
                    fontFamily: F.display, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
                    textTransform: "uppercase", padding: "14px 36px", borderRadius: 10,
                    background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
                    cursor: "pointer", transition: "all 0.25s",
                  }}
                >
                  Get Started
                </button>
                <a
                  href="#features"
                  className="lp-btn-outline"
                  style={{
                    fontFamily: F.display, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
                    textTransform: "uppercase", padding: "14px 36px", borderRadius: 10,
                    background: C.linen, color: C.dark, border: `2px solid ${C.teal}`,
                    cursor: "pointer", transition: "all 0.25s", textDecoration: "none",
                    display: "inline-flex", alignItems: "center",
                  }}
                >
                  See Features
                </a>
              </div>
            </div>

            {/* Hero visual — stylized dashboard preview */}
            <div className="lp-fade lp-fade-d4" style={{ flex: 1, maxWidth: 480 }}>
              <div style={{
                background: C.darkRaised, borderRadius: 16, border: `1px solid ${C.darkBorder}`,
                padding: "28px 24px", boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e53935" }} />
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f9a825" }} />
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#43a047" }} />
                  <span style={{ fontFamily: F.ui, fontSize: 11, color: "rgba(255,255,255,0.25)", marginLeft: 8 }}>Sales Command Dashboard</span>
                </div>
                {[
                  { label: "New Leads", pct: 85, color: C.teal },
                  { label: "Proposals Sent", pct: 62, color: C.tealDark },
                  { label: "Jobs Sold", pct: 44, color: C.tealDeep },
                  { label: "Invoiced", pct: 38, color: C.amber },
                ].map((bar, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{bar.label}</span>
                      <span style={{ fontFamily: F.ui, fontSize: 11, fontWeight: 700, color: bar.color }}>{bar.pct}%</span>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                      <div style={{ width: `${bar.pct}%`, height: "100%", background: bar.color, borderRadius: 3, transition: "width 1s ease" }} />
                    </div>
                  </div>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 20 }}>
                  {[
                    { label: "Revenue", val: "$284K" },
                    { label: "Win Rate", val: "72%" },
                    { label: "Avg Close", val: "11 days" },
                  ].map((s, i) => (
                    <div key={i} style={{
                      background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "12px 10px",
                      border: `1px solid ${C.darkBorder}`, textAlign: "center",
                    }}>
                      <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 800, color: C.teal }}>{s.val}</div>
                      <div style={{ fontFamily: F.ui, fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── STATS BAR ── */}
        <section style={{ background: C.dark, borderTop: `2px solid ${C.teal}`, borderBottom: `2px solid ${C.teal}`, padding: "40px 40px" }}>
          <div className="lp-stats-row" style={{ maxWidth: 800, margin: "0 auto", display: "flex", justifyContent: "space-around", gap: 40 }}>
            {STATS.map((s, i) => (
              <div key={i} style={{ textAlign: "center", border: "2px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "20px 36px" }}>
                <div style={{ fontFamily: F.display, fontSize: 32, fontWeight: 800, color: C.teal, letterSpacing: "0.02em" }}>{s.value}</div>
                <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" className="lp-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>Everything You Need</div>
              <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: 0, color: C.textHead }}>
                One Platform. <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Total Control.</span>
              </h2>
            </div>
            <div className="lp-features-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
              {FEATURES.map((f, i) => (
                <div
                  key={i}
                  className="lp-card"
                  onClick={() => navigate(`/features/${f.slug}`)}
                  style={{
                    background: C.linenCard, borderRadius: 14, padding: "32px 28px",
                    border: `1px solid ${C.borderStrong}`, transition: "all 0.25s", cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(28,24,20,0.08)",
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 16 }}>{f.icon}</div>
                  <h3 style={{ fontFamily: F.display, fontSize: 17, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px", color: C.textHead }}>{f.title}</h3>
                  <p style={{ fontFamily: F.body, fontSize: 14, lineHeight: 1.6, color: C.textLight, margin: "0 0 14px" }}>{f.desc}</p>
                  <span style={{
                    fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: C.teal,
                  }}>
                    Learn More &rarr;
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" className="lp-section" style={{ padding: "90px 40px", background: C.linenDeep }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>Simple Process</div>
              <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: 0, color: C.textHead }}>
                How It <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Works</span>
              </h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { step: "01", title: "Log the Call", desc: "A lead comes in — log the customer, jobsite, and scope in seconds. Your pipeline starts here." },
                { step: "02", title: "Build & Send Proposals", desc: "Use the work type calculator to price the job accurately. Generate a professional proposal and send it for e-signature." },
                { step: "03", title: "Invoice & Get Paid", desc: "Create invoices tied to proposals, collect payments via Stripe, and sync everything to QuickBooks automatically." },
                { step: "04", title: "Track & Grow", desc: "See your pipeline, win rate, and revenue in real time. Know exactly where every dollar is." },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 28, padding: "32px 0", borderBottom: i < 3 ? `1px solid ${C.border}` : "none", alignItems: "flex-start" }}>
                  <div style={{
                    fontFamily: F.display, fontSize: 36, fontWeight: 800, color: C.teal,
                    opacity: 0.5, lineHeight: 1, flexShrink: 0, width: 56,
                    WebkitTextStroke: `1px ${C.dark}`,
                  }}>{s.step}</div>
                  <div>
                    <h3 style={{ fontFamily: F.display, fontSize: 20, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px", color: C.textHead }}>{s.title}</h3>
                    <p style={{ fontFamily: F.body, fontSize: 15, lineHeight: 1.6, color: C.textLight, margin: 0 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="lp-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>Pricing</div>
            <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 20px", color: C.textHead }}>
              Simple, <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Honest</span> Pricing
            </h2>
            <div style={{
              background: C.dark, borderRadius: 16, padding: "48px 40px",
              border: `1px solid ${C.darkBorder}`, boxShadow: "0 8px 40px rgba(28,24,20,0.25)",
            }}>
              <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.teal, marginBottom: 8 }}>Pro Plan</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4, marginBottom: 20 }}>
                <span style={{ fontFamily: F.display, fontSize: 52, fontWeight: 800, color: "#fff" }}>$99</span>
                <span style={{ fontFamily: F.ui, fontSize: 14, color: "rgba(255,255,255,0.4)" }}>/month</span>
              </div>
              <div style={{ fontFamily: F.body, fontSize: 14, lineHeight: 1.8, color: "rgba(255,255,255,0.5)", marginBottom: 28 }}>
                Unlimited users, proposals, invoices, QuickBooks sync,<br />
                Stripe payments, and e-signatures. Everything included.
              </div>
              <button
                onClick={() => navigate("/checkout")}
                className="lp-btn"
                style={{
                  fontFamily: F.display, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", padding: "14px 48px", borderRadius: 10,
                  background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                  transition: "all 0.25s",
                }}
              >
                Start Now
              </button>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section style={{ padding: "80px 40px", textAlign: "center", borderTop: `1px solid ${C.border}` }}>
          <h2 style={{ fontFamily: F.display, fontSize: 34, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 16px", color: C.textHead }}>
            Ready to Take <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Command</span>?
          </h2>
          <p style={{ fontFamily: F.body, fontSize: 16, color: C.textMuted, marginBottom: 28 }}>
            Your sales pipeline, proposals, invoices, and books — all in one place.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="lp-btn"
            style={{
              fontFamily: F.display, fontSize: 16, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", padding: "16px 48px", borderRadius: 10,
              background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
              cursor: "pointer", transition: "all 0.25s",
            }}
          >
            Sign In
          </button>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          padding: "32px 40px", borderTop: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SalesCommandMark size={24} />
            <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint }}>
              Sales <span style={{ color: C.teal }}>Command</span>
            </span>
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 11, color: C.textFaint }}>
            &copy; {new Date().getFullYear()} Sales Command. All rights reserved.
          </div>
        </footer>

      </div>

    </>
  );
}
