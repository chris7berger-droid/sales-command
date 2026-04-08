import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, GLOBAL_CSS } from "../lib/tokens";

const PRODUCTS = [
  {
    icon: "💰",
    name: "Sales",
    tagline: "Run Your Sales. Command Your Revenue.",
    desc: "Leads, proposals, invoicing, QuickBooks sync, and Stripe payments — all in one system built for subcontractors.",
    status: "live",
    href: "https://salescommand.app",
  },
  {
    icon: "📅",
    name: "Schedule",
    tagline: "Crew Scheduling. Zero Confusion.",
    desc: "Assign crews to jobs, manage availability, and keep everyone on the same page — from the office to the field.",
    status: "coming-soon",
  },
  {
    icon: "🏗️",
    name: "Field",
    tagline: "Track Production. Own the Jobsite.",
    desc: "Daily logs, production tracking, photos, and punch lists — real-time visibility from the field to the front office.",
    status: "coming-soon",
  },
  {
    icon: "📊",
    name: "AR",
    tagline: "Collect Faster. Stay Cash Positive.",
    desc: "Accounts receivable tracking, aging reports, automated follow-ups, and payment visibility across every job.",
    status: "coming-soon",
  },
];

function SuiteLogoMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="17" stroke={C.teal} strokeWidth="1.5" fill="none"/>
      <circle cx="20" cy="20" r="11" stroke={C.teal} strokeWidth="1" fill="rgba(48,207,172,0.06)"/>
      <line x1="20" y1="3"  x2="20" y2="8"  stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="20" y1="32" x2="20" y2="37" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="3"  y1="20" x2="8"  y2="20" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="32" y1="20" x2="37" y2="20" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <text x="20" y="24" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="800" fontSize="10" fill="#ffffff" letterSpacing="0.5">SCC</text>
    </svg>
  );
}

const SCC_FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" stroke="%2330cfac" stroke-width="1.5" fill="%231c1814"/><circle cx="20" cy="20" r="11" stroke="%2330cfac" stroke-width="1" fill="rgba(48,207,172,0.06)"/><line x1="20" y1="3" x2="20" y2="8" stroke="%2330cfac" stroke-width="1.5" stroke-linecap="round"/><line x1="20" y1="32" x2="20" y2="37" stroke="%2330cfac" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="20" x2="8" y2="20" stroke="%2330cfac" stroke-width="1.5" stroke-linecap="round"/><line x1="32" y1="20" x2="37" y2="20" stroke="%2330cfac" stroke-width="1.5" stroke-linecap="round"/><text x="20" y="24" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="10" fill="%23ffffff" letter-spacing="0.5">SCC</text></svg>')}`;

export default function SubConCommandPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.title = "Sub Con Command";
    const link = document.querySelector("link[rel='icon']");
    if (link) link.href = SCC_FAVICON;
  }, []);

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        .scc-fade { animation: fadeUp 0.7s ease-out both; }
        .scc-fade-d1 { animation-delay: 0.1s; }
        .scc-fade-d2 { animation-delay: 0.2s; }
        .scc-fade-d3 { animation-delay: 0.35s; }
        .scc-fade-d4 { animation-delay: 0.5s; }
        .scc-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(48,207,172,0.25) !important; }
        .scc-btn-outline:hover { background: rgba(48,207,172,0.08) !important; }
        .scc-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(28,24,20,0.18) !important; border-color: ${C.teal} !important; }
        .scc-card-live:hover { border-color: ${C.teal} !important; }
        .scc-nav-link:hover { color: ${C.teal} !important; }
        @media (max-width: 768px) {
          .scc-hero-grid { flex-direction: column !important; text-align: center !important; }
          .scc-hero-text { align-items: center !important; }
          .scc-products-grid { grid-template-columns: 1fr !important; }
          .scc-stats-row { flex-direction: column !important; gap: 24px !important; }
          .scc-nav-links { display: none !important; }
          .scc-hamburger { display: flex !important; }
          .scc-hero-h1 { font-size: 44px !important; }
          .scc-section { padding: 60px 20px !important; }
          .scc-cta-buttons { flex-direction: column !important; align-items: center !important; }
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
            <SuiteLogoMark size={32} />
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff" }}>
              Sub Con <span style={{ color: C.teal }}>Command</span>
            </div>
          </div>
          <div className="scc-nav-links" style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <a href="#products" className="scc-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>Products</a>
            <a href="#vision" className="scc-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>Vision</a>
            <a href="#about" className="scc-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.2s" }}>About</a>
            <a
              href="https://salescommand.app"
              className="scc-btn"
              style={{
                fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "9px 24px", borderRadius: 8,
                background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                transition: "all 0.2s", textDecoration: "none",
              }}
            >
              Sales Command
            </a>
          </div>
          <button
            className="scc-hamburger"
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
            <a href="#products" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Products</a>
            <a href="#vision" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Vision</a>
            <a href="#about" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>About</a>
            <a
              href="https://salescommand.app"
              style={{
                fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "12px 24px", borderRadius: 8,
                background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                marginTop: 4, textDecoration: "none", textAlign: "center",
              }}
            >
              Sales Command
            </a>
          </div>
        )}

        {/* ── HERO ── */}
        <section style={{ padding: "140px 40px 80px" }}>
          <div className="scc-hero-grid" style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 60 }}>
            <div className="scc-hero-text" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 24 }}>
              <div className="scc-fade" style={{
                fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em",
                textTransform: "uppercase", color: C.teal, background: C.dark,
                border: `1px solid ${C.tealBorder}`, padding: "6px 16px", borderRadius: 20,
              }}>
                The Command Suite for SubContractors
              </div>
              <h1 className="scc-fade scc-fade-d1 scc-hero-h1" style={{
                fontFamily: F.display, fontSize: 56, fontWeight: 800, lineHeight: 1.05,
                letterSpacing: "0.02em", textTransform: "uppercase", margin: 0, color: C.textHead,
              }}>
                One Suite.<br />
                <span style={{ color: C.teal, WebkitTextStroke: `1.5px ${C.dark}` }}>Total</span> Command.
              </h1>
              <p className="scc-fade scc-fade-d2" style={{
                fontFamily: F.body, fontSize: 17, lineHeight: 1.65, color: C.textMuted,
                maxWidth: 480,
              }}>
                Sub Con Command is the software platform built by subcontractors,
                for subcontractors. Sales, scheduling, field operations, and
                accounts receivable — connected tools designed for the way you
                actually run your business.
              </p>
              <div className="scc-fade scc-fade-d3 scc-cta-buttons" style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <a
                  href="https://salescommand.app"
                  className="scc-btn"
                  style={{
                    fontFamily: F.display, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
                    textTransform: "uppercase", padding: "14px 36px", borderRadius: 10,
                    background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
                    cursor: "pointer", transition: "all 0.25s", textDecoration: "none",
                  }}
                >
                  Launch Sales Command
                </a>
                <a
                  href="#products"
                  className="scc-btn-outline"
                  style={{
                    fontFamily: F.display, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
                    textTransform: "uppercase", padding: "14px 36px", borderRadius: 10,
                    background: C.linen, color: C.dark, border: `2px solid ${C.teal}`,
                    cursor: "pointer", transition: "all 0.25s", textDecoration: "none",
                    display: "inline-flex", alignItems: "center",
                  }}
                >
                  See All Products
                </a>
              </div>
            </div>

            {/* Hero visual — Command Suite diagram */}
            <div className="scc-fade scc-fade-d4" style={{ flex: 1, maxWidth: 480 }}>
              <div style={{
                background: C.darkRaised, borderRadius: 16, border: `1px solid ${C.darkBorder}`,
                padding: "32px 28px", boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
              }}>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: C.teal, marginBottom: 4 }}>Command Suite</div>
                  <div style={{ fontFamily: F.ui, fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Connected Tools. One Platform.</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {PRODUCTS.map((p, i) => {
                    const Wrap = p.status === "live" ? "a" : "div";
                    const wrapProps = p.status === "live" ? { href: p.href, target: "_blank", rel: "noopener noreferrer", style: { textDecoration: "none" } } : {};
                    return (
                    <Wrap key={i} {...wrapProps}>
                    <div style={{
                      background: p.status === "live" ? "rgba(48,207,172,0.08)" : "rgba(255,255,255,0.03)",
                      borderRadius: 10, padding: "16px 14px",
                      border: `1px solid ${p.status === "live" ? C.tealBorder : C.darkBorder}`,
                      textAlign: "center", cursor: p.status === "live" ? "pointer" : "default",
                    }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>{p.icon}</div>
                      <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", marginBottom: 4 }}>
                        {p.name}
                      </div>
                      {p.status === "live" ? (
                        <div style={{
                          fontFamily: F.ui, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                          textTransform: "uppercase", color: C.teal,
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.teal, display: "inline-block" }} />
                          Live
                        </div>
                      ) : (
                        <div style={{
                          fontFamily: F.ui, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
                          textTransform: "uppercase", color: "rgba(255,255,255,0.3)",
                        }}>
                          Coming Soon
                        </div>
                      )}
                    </div>
                    </Wrap>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── STATS BAR ── */}
        <section style={{ background: C.dark, borderTop: `2px solid ${C.teal}`, borderBottom: `2px solid ${C.teal}`, padding: "40px 40px" }}>
          <div className="scc-stats-row" style={{ maxWidth: 900, margin: "0 auto", display: "flex", justifyContent: "space-around", gap: 40 }}>
            {[
              { value: "4", label: "Command Products" },
              { value: "1", label: "Connected Platform" },
              { value: "100%", label: "Built for Subs" },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center", border: "2px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "20px 36px" }}>
                <div style={{ fontFamily: F.display, fontSize: 32, fontWeight: 800, color: C.teal, letterSpacing: "0.02em" }}>{s.value}</div>
                <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PRODUCTS ── */}
        <section id="products" className="scc-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>The Command Suite</div>
              <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: 0, color: C.textHead }}>
                Every Tool You <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Need.</span>
              </h2>
            </div>
            <div className="scc-products-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              {PRODUCTS.map((p, i) => (
                <div
                  key={i}
                  className={`scc-card ${p.status === "live" ? "scc-card-live" : ""}`}
                  style={{
                    background: C.linenCard, borderRadius: 16, padding: "36px 32px",
                    border: `1px solid ${p.status === "live" ? C.teal : C.borderStrong}`,
                    transition: "all 0.25s", cursor: p.status === "live" ? "pointer" : "default",
                    boxShadow: "0 4px 20px rgba(28,24,20,0.08)",
                    position: "relative", overflow: "hidden",
                  }}
                  onClick={p.status === "live" ? () => window.open(p.href, "_blank") : undefined}
                >
                  {/* Status badge */}
                  <div style={{
                    position: "absolute", top: 20, right: 20,
                    fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "4px 12px", borderRadius: 20,
                    ...(p.status === "live"
                      ? { background: C.dark, color: C.teal, border: `1px solid ${C.tealBorder}` }
                      : { background: C.linenDeep, color: C.textLight, border: `1px solid ${C.border}` }
                    ),
                  }}>
                    {p.status === "live" ? "Live Now" : "Coming Soon"}
                  </div>

                  <div style={{ fontSize: 40, marginBottom: 16 }}>{p.icon}</div>
                  <h3 style={{ fontFamily: F.display, fontSize: 24, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 4px", color: C.textHead }}>
                    {p.name} <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Command</span>
                  </h3>
                  <p style={{
                    fontFamily: F.display, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase", color: C.teal, margin: "0 0 14px",
                    background: C.dark, display: "inline-block", padding: "4px 12px", borderRadius: 6,
                  }}>{p.tagline}</p>
                  <p style={{ fontFamily: F.body, fontSize: 15, lineHeight: 1.65, color: C.textLight, margin: "0 0 20px" }}>{p.desc}</p>

                  {p.status === "live" ? (
                    <span style={{
                      fontFamily: F.display, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em",
                      textTransform: "uppercase", color: C.teal,
                      background: C.dark, padding: "6px 14px", borderRadius: 6,
                    }}>
                      Launch App &rarr;
                    </span>
                  ) : (
                    <span style={{
                      fontFamily: F.ui, fontSize: 12, fontWeight: 600,
                      color: C.textFaint, fontStyle: "italic",
                    }}>
                      Stay tuned for updates
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── VISION ── */}
        <section id="vision" className="scc-section" style={{ padding: "90px 40px", background: C.linenDeep }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>The Vision</div>
              <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: 0, color: C.textHead }}>
                Built for the <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Whole</span> Operation
              </h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { step: "01", title: "Sell the Work", desc: <><a href="https://salescommand.app" style={{ color: C.teal, fontWeight: 600, textDecoration: "none" }}>Sales Command</a> handles your pipeline from first call to signed proposal. Leads, proposals, e-signatures, and invoicing — all connected.</> },
                { step: "02", title: "Schedule the Crews", desc: "Schedule Command will give you drag-and-drop crew scheduling, availability tracking, and job assignments — no more spreadsheets or whiteboards." },
                { step: "03", title: "Run the Jobsite", desc: "Field Command will bring daily logs, production tracking, photos, and punch lists into one place — real-time updates from the field to the front office." },
                { step: "04", title: "Collect the Money", desc: "AR Command will track every dollar owed, automate follow-ups, and give you aging visibility across all jobs — so nothing slips through the cracks." },
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

        {/* ── ABOUT ── */}
        <section id="about" className="scc-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, background: C.dark, display: "inline-block", padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>About</div>
            <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 20px", color: C.textHead }}>
              By Subs, <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>For</span> Subs
            </h2>
            <p style={{ fontFamily: F.body, fontSize: 17, lineHeight: 1.7, color: C.textMuted, marginBottom: 16 }}>
              The software you've been using wasn't built by someone who's run crews,
              chased change orders, or waited 90 days on a check. Sub Con Command was.
            </p>
            <p style={{ fontFamily: F.body, fontSize: 17, lineHeight: 1.7, color: C.textMuted, marginBottom: 0 }}>
              We're building a connected platform where every tool talks to the others —
              so you stop double-entering data and start running your business from one place.
            </p>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section style={{ padding: "80px 40px", textAlign: "center", borderTop: `1px solid ${C.border}` }}>
          <h2 style={{ fontFamily: F.display, fontSize: 34, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 16px", color: C.textHead }}>
            Ready to Take <span style={{ color: C.teal, WebkitTextStroke: `1px ${C.dark}` }}>Command</span>?
          </h2>
          <p style={{ fontFamily: F.body, fontSize: 16, color: C.textMuted, marginBottom: 28 }}>
            Start with Sales Command today. The rest of the suite is on the way.
          </p>
          <a
            href="https://salescommand.app"
            className="scc-btn"
            style={{
              fontFamily: F.display, fontSize: 16, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", padding: "16px 48px", borderRadius: 10,
              background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
              cursor: "pointer", transition: "all 0.25s", textDecoration: "none",
              display: "inline-block",
            }}
          >
            Launch Sales Command
          </a>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          padding: "32px 40px", borderTop: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SuiteLogoMark size={24} />
            <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint }}>
              Sub Con <span style={{ color: C.teal }}>Command</span>
            </span>
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 11, color: C.textFaint }}>
            &copy; {new Date().getFullYear()} Sub Con Command. All rights reserved.
          </div>
        </footer>

      </div>
    </>
  );
}
