import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { C, F, GLOBAL_CSS } from "../lib/tokens";
import { SalesCommandMark } from "../components/Logo";

const FEATURES = {
  "call-log-pipeline": {
    icon: "📋",
    title: "Call Log & Pipeline",
    summary: "Your entire sales pipeline — from the first phone call to a signed contract — lives in one place. Log inquiries in seconds, assign sales reps, track bid due dates, and watch every job move through your stages automatically.",
    pain: "Right now, leads come in by phone, text, and email. They get scribbled on Post-its, buried in inboxes, or forgotten entirely. By the time you follow up, the GC already gave it to someone else. You're not losing jobs because of price — you're losing them because they fell through the cracks.",
    function: "Sales Command's Call Log captures the customer, jobsite, scope, and bid due date the moment the phone rings. Every inquiry gets a stage — New, Estimating, Bid Submitted, Sold, Lost — so you always know where every opportunity stands. Filter by stage, sort by due date, and never miss a follow-up again.",
    momentum: "Every lead tracked is a job you didn't lose. Every follow-up on time is trust you just built. This is how subcontractors stop chasing and start closing.",
    // Hero: construction crew on an active jobsite
    heroImg: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1400&q=80",
    // Pain: messy desk with scattered papers, sticky notes, overwhelm
    painImg: "https://images.unsplash.com/photo-1568667256549-094345857637?w=800&q=80",
    // Solve: guy on phone at a jobsite, organized, in control
    solveImg: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=800&q=80",
    // Trust: construction team doing a morning huddle / whiteboard planning
    trustImg: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80",
    stats: [
      { value: "37%", label: "of subcontractor leads get no follow-up" },
      { value: "2.4x", label: "more jobs closed with pipeline tracking" },
      { value: "<60s", label: "to log a new inquiry" },
    ],
  },
  "proposals-e-sign": {
    icon: "📄",
    title: "Proposals & E-Sign",
    summary: "Build professional, accurate proposals using built-in work type calculators. Price labor, materials, travel, and markup with precision — then send for e-signature and get the contract back before your competitor even opens Excel.",
    pain: "You're spending hours in spreadsheets trying to build proposals, manually calculating labor burden, material markup, and travel. Then you email a PDF, wait days for a signature, and wonder if they even opened it. Meanwhile, the job sits in limbo and your cash flow stalls.",
    function: "The Work Type Calculator prices every line item — regular and OT labor with burden rates, materials with tax and freight, travel, markup, and discount. Lock the numbers, generate a branded PDF proposal, and send it for e-signature in one click. Your customer signs on their phone in 30 seconds. Done.",
    momentum: "A proposal that takes 5 minutes instead of 5 hours doesn't just save time — it gets you to 'yes' before anyone else even submits. Speed wins jobs. Accuracy keeps them profitable.",
    // Hero: blueprints and plans spread on a construction table
    heroImg: "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80",
    // Pain: frustrated man at laptop, head in hands, late night paperwork
    painImg: "https://images.unsplash.com/photo-1586473219010-2ffc57b0d282?w=800&q=80",
    // Solve: contractor using tablet/phone on jobsite, simple and quick
    solveImg: "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800&q=80",
    // Trust: handshake at a construction site, deal done
    trustImg: "https://images.unsplash.com/photo-1521791055366-0d553872125f?w=800&q=80",
    stats: [
      { value: "5 min", label: "average proposal build time" },
      { value: "30 sec", label: "for customer to e-sign" },
      { value: "100%", label: "paperless from bid to contract" },
    ],
  },
  "invoicing-payments": {
    icon: "💵",
    title: "Invoicing & Payments",
    summary: "Create invoices directly from your proposals, send them with a Stripe payment link, and get paid online. No more chasing checks. No more 90-day receivables. Money moves when the work is done.",
    pain: "You finished the job three weeks ago. The invoice went out by email — maybe. The customer says they never got it. Accounting is asking where the money is. You're floating payroll on a line of credit while $47,000 sits in someone's 'to pay' pile. Sound familiar?",
    function: "Sales Command generates invoices tied directly to your proposals and work types. Bill by percentage, add discounts, and send with a secure Stripe checkout link. Your customer clicks, pays by card or ACH, and you get notified instantly. Track sent, paid, and overdue invoices from one screen.",
    momentum: "Getting paid shouldn't be the hardest part of the job. When invoicing takes 60 seconds and payment takes one click, your cash flow stops being a problem and starts being a weapon.",
    // Hero: construction equipment on site, the work that needs to get paid for
    heroImg: "https://images.unsplash.com/photo-1581094271901-8022df4466f9?w=1400&q=80",
    // Pain: stack of unpaid invoices, paper chaos, overdue stamps
    painImg: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80",
    // Solve: person tapping phone to pay, simple mobile payment
    solveImg: "https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=800&q=80",
    // Trust: crew at end of day, job done, ready to get paid
    trustImg: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80",
    stats: [
      { value: "60 sec", label: "from proposal to invoice" },
      { value: "1 click", label: "customer payment via Stripe" },
      { value: "Real-time", label: "payment notifications" },
    ],
  },
  "quickbooks-sync": {
    icon: "📊",
    title: "QuickBooks Sync",
    summary: "Connect QuickBooks in one click. From that moment on, every customer, job, invoice, and payment syncs automatically. Your books stay clean without anyone touching them.",
    pain: "You or your bookkeeper is manually re-entering every customer, every invoice, and every payment into QuickBooks. It takes hours every week, mistakes happen constantly, and reconciliation is a nightmare. You're paying for software that's supposed to save time — but you're doing the work twice.",
    function: "When a proposal hits 'Sold,' Sales Command creates the customer and job in QuickBooks automatically. When you send an invoice, it appears in QB. When it's paid, the payment records itself. Parent customers, sub-customers (jobs), line items, departments — all mapped correctly, every time.",
    momentum: "Zero double entry. Zero reconciliation headaches. Your bookkeeper just got their week back — and your financials are actually accurate for the first time in years.",
    // Hero: office/trailer with laptop and hard hat — where the books get done
    heroImg: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1400&q=80",
    // Pain: person overwhelmed staring at closed laptop, doesn't want to open it
    painImg: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80",
    // Solve: clean simple desk, laptop open, coffee — calm and in control
    solveImg: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&q=80",
    // Trust: small team in a construction trailer, working together
    trustImg: "https://images.unsplash.com/photo-1531538606174-e5e3a0f57805?w=800&q=80",
    stats: [
      { value: "Zero", label: "manual data entry" },
      { value: "Auto", label: "customer, invoice & payment sync" },
      { value: "100%", label: "accurate books, every time" },
    ],
  },
  "job-management": {
    icon: "🏗️",
    title: "Job Management",
    summary: "Every job, change order, and work type lives in a structured system. Track scope, manage change orders as linked sub-jobs, and keep your project history organized from bid to closeout.",
    pain: "Change orders get verbally approved and never documented. Job details live in three different places — your head, a spreadsheet, and a filing cabinet. When something goes sideways on-site, nobody can find the original scope. You eat the cost because you can't prove what was agreed.",
    function: "Each job in Sales Command carries its full history — customer, jobsite address, scope, work types, proposals, invoices, and change orders. Change orders are linked to parent jobs with their own numbering, proposals, and billing. Everything is traceable, searchable, and bulletproof.",
    momentum: "A job you can trace from first call to final payment isn't just organized — it's protected. When disputes happen (and they will), you'll have every detail at your fingertips. That's not just management. That's command.",
    // Hero: active commercial construction site, steel framing
    heroImg: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1400&q=80",
    // Pain: filing cabinet overflowing, paper folders, disorganized records
    painImg: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=800&q=80",
    // Solve: whiteboard with organized sticky notes, kanban-style planning
    solveImg: "https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?w=800&q=80",
    // Trust: foreman reviewing plans with crew on site
    trustImg: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80",
    stats: [
      { value: "Full", label: "job history from bid to closeout" },
      { value: "Linked", label: "change orders with own billing" },
      { value: "Instant", label: "scope & document lookup" },
    ],
  },
  "sales-dashboards": {
    icon: "🏆",
    title: "Sales Dashboards",
    summary: "See your entire sales operation at a glance. Pipeline value, win rates, revenue by rep, bid due dates, and stage breakdowns — all updating in real time, all in one dashboard.",
    pain: "You have no idea how much is in your pipeline right now. You can't tell which rep is closing and which is coasting. Bid due dates sneak up on you. Month-end revenue is a surprise — sometimes good, usually not. You're running a business blind.",
    function: "The Sales Dashboard shows pipeline value by stage, jobs won and lost, revenue trends, and team performance metrics. The Home screen surfaces upcoming bid due dates, recent activity, and stage counts so you start every day knowing exactly where you stand.",
    momentum: "You can't grow what you can't see. When every dollar in your pipeline is visible and every trend is tracked, you stop reacting and start deciding. That's the difference between running a crew and running a company.",
    // Hero: sunrise over a commercial building under construction
    heroImg: "https://images.unsplash.com/photo-1429497419816-9ca5cfb4571a?w=1400&q=80",
    // Pain: guy rubbing his eyes at desk, exhausted, end of long day
    painImg: "https://images.unsplash.com/photo-1560264280-88b68371db39?w=800&q=80",
    // Solve: simple whiteboard with clear metrics, markers — not a fancy dashboard
    solveImg: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80",
    // Trust: construction owner standing proud in front of completed project
    trustImg: "https://images.unsplash.com/photo-1507537297725-24a1c029d3ca?w=800&q=80",
    stats: [
      { value: "Real-time", label: "pipeline & revenue visibility" },
      { value: "Per-rep", label: "performance tracking" },
      { value: "Daily", label: "bid due date surfacing" },
    ],
  },
};

export const FEATURE_SLUGS = Object.keys(FEATURES);

export default function FeatureDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const f = FEATURES[slug];

  if (!f) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div style={{ minHeight: "100vh", background: C.linen, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
          <div style={{ fontFamily: F.display, fontSize: 24, fontWeight: 800, color: C.textHead, textTransform: "uppercase" }}>Feature not found</div>
          <button onClick={() => navigate("/")} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, padding: "12px 32px", borderRadius: 8, background: C.teal, color: C.dark, border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>Back to Home</button>
        </div>
      </>
    );
  }

  const imgStyle = (url) => ({
    width: "100%", minHeight: 280, aspectRatio: "16/10", borderRadius: 14,
    display: "block",
    background: `url(${url}) center/cover no-repeat ${C.linenDeep}`,
  });

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <style>{`
        .fd-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(48,207,172,0.25) !important; }
        .fd-nav-link:hover { color: ${C.teal} !important; }
        @media (max-width: 768px) {
          .fd-two-col { flex-direction: column !important; }
          .fd-two-col-reverse { flex-direction: column-reverse !important; }
          .fd-hero-h1 { font-size: 36px !important; }
          .fd-section { padding: 60px 20px !important; }
          .fd-img { min-height: 220px !important; aspect-ratio: 16/10 !important; }
          .fd-trust-img { height: 220px !important; }
          .fd-hero-banner { height: 280px !important; }
          .fd-nav-desktop { display: none !important; }
          .fd-hamburger { display: flex !important; }
        }
      `}</style>

      <div style={{ background: C.linen, color: C.textBody, minHeight: "100vh" }}>

        {/* ── NAV ── */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
          background: "rgba(28,24,20,0.92)", backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${C.darkBorder}`,
          padding: "0 40px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <SalesCommandMark size={32} />
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff" }}>
              Sales <span style={{ color: C.teal }}>Command</span>
            </div>
          </div>
          <div className="fd-nav-desktop" style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <button onClick={() => navigate("/")} className="fd-nav-link" style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", background: "none", border: "none", cursor: "pointer", transition: "color 0.2s" }}>
              &larr; Back
            </button>
            <button
              onClick={() => navigate("/login")}
              className="fd-btn"
              style={{
                fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "9px 24px", borderRadius: 8,
                background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              Sign In
            </button>
          </div>
          <button
            className="fd-hamburger"
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

        {menuOpen && (
          <div style={{
            position: "fixed", top: 64, left: 0, right: 0, zIndex: 99,
            background: C.dark, borderBottom: `2px solid ${C.teal}`,
            padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16,
            animation: "fadeIn 0.2s ease-out",
          }}>
            <a href="/" onClick={() => setMenuOpen(false)} style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>&larr; Back to Home</a>
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

        {/* ── HERO BANNER ── */}
        <section style={{ position: "relative", paddingTop: 64 }}>
          <div className="fd-hero-banner" style={{
            height: 400, width: "100%",
            backgroundImage: `linear-gradient(to bottom, rgba(28,24,20,0.55), rgba(28,24,20,0.85)), url(${f.heroImg})`,
            backgroundSize: "cover", backgroundPosition: "center",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 16, padding: "0 40px", textAlign: "center",
          }}>
            <div style={{ fontSize: 56, marginBottom: 4 }}>{f.icon}</div>
            <h1 className="fd-hero-h1" style={{
              fontFamily: F.display, fontSize: 48, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.04em",
              color: "#fff", margin: 0, maxWidth: 700,
            }}>
              {f.title}
            </h1>
            <div style={{
              width: 60, height: 3, background: C.teal, borderRadius: 2, margin: "4px 0",
            }} />
          </div>
        </section>

        {/* ── SUMMARY ── */}
        <section className="fd-section" style={{ padding: "80px 40px" }}>
          <div style={{ maxWidth: 780, margin: "0 auto", textAlign: "center" }}>
            <p style={{
              fontFamily: F.body, fontSize: 20, lineHeight: 1.75,
              color: C.textBody,
            }}>
              {f.summary}
            </p>
          </div>
        </section>

        {/* ── STATS BAR ── */}
        <section style={{ background: C.dark, padding: "48px 40px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", justifyContent: "space-around", gap: 40, flexWrap: "wrap" }}>
            {f.stats.map((s, i) => (
              <div key={i} style={{ textAlign: "center", minWidth: 180 }}>
                <div style={{ fontFamily: F.display, fontSize: 36, fontWeight: 800, color: C.teal, letterSpacing: "0.02em" }}>{s.value}</div>
                <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 6, maxWidth: 200 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── THE PAIN ── */}
        <section className="fd-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div className="fd-two-col" style={{ display: "flex", gap: 48, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: F.display, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.16em", textTransform: "uppercase",
                  color: C.red, marginBottom: 14,
                }}>
                  The Problem You Know Too Well
                </div>
                <h2 style={{
                  fontFamily: F.display, fontSize: 30, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.03em",
                  color: C.textHead, margin: "0 0 20px",
                }}>
                  It's Not You. <span style={{ color: C.red }}>It's Your Software.</span>
                </h2>
                <p style={{
                  fontFamily: F.body, fontSize: 16, lineHeight: 1.75,
                  color: C.textMuted,
                }}>
                  {f.pain}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <div className="fd-img" style={{
                  ...imgStyle(f.painImg),
                  boxShadow: "0 16px 48px rgba(28,24,20,0.15)",
                  border: `3px solid rgba(229,57,53,0.2)`,
                }} />
              </div>
            </div>
          </div>
        </section>

        {/* ── DIVIDER ── */}
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 40px" }}>
          <div style={{ height: 1, background: C.border }} />
        </div>

        {/* ── THE SOLUTION ── */}
        <section className="fd-section" style={{ padding: "90px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div className="fd-two-col fd-two-col-reverse" style={{ display: "flex", gap: 48, alignItems: "center", flexDirection: "row-reverse" }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: F.display, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.16em", textTransform: "uppercase",
                  color: C.teal, marginBottom: 14,
                }}>
                  How Sales Command Solves It
                </div>
                <h2 style={{
                  fontFamily: F.display, fontSize: 30, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.03em",
                  color: C.textHead, margin: "0 0 20px",
                }}>
                  Built by a Sub. <span style={{ color: C.teal }}>For Subs.</span>
                </h2>
                <p style={{
                  fontFamily: F.body, fontSize: 16, lineHeight: 1.75,
                  color: C.textMuted,
                }}>
                  {f.function}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <div className="fd-img" style={{
                  ...imgStyle(f.solveImg),
                  boxShadow: "0 16px 48px rgba(28,24,20,0.15)",
                  border: `3px solid ${C.tealBorder}`,
                }} />
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST IMAGE + MOMENTUM ── */}
        <section style={{ background: C.dark, padding: "90px 40px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            {/* Trust image */}
            <div className="fd-trust-img" style={{
              width: "100%", height: 360,
              backgroundImage: `linear-gradient(to bottom, rgba(28,24,20,0.15), rgba(28,24,20,0.5)), url(${f.trustImg})`,
              backgroundSize: "cover", backgroundPosition: "center",
              borderRadius: 16, marginBottom: 56,
              boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
            }} />

            {/* Momentum quote */}
            <div style={{ textAlign: "center", maxWidth: 700, margin: "0 auto" }}>
              <div style={{
                fontFamily: F.display, fontSize: 11, fontWeight: 700,
                letterSpacing: "0.2em", textTransform: "uppercase",
                color: C.teal, marginBottom: 20,
              }}>
                The Momentum Shift
              </div>
              <p style={{
                fontFamily: F.display, fontSize: 24, fontWeight: 700,
                lineHeight: 1.5, color: "#fff", margin: "0 0 40px",
                letterSpacing: "0.01em",
              }}>
                &ldquo;{f.momentum}&rdquo;
              </p>
              <div style={{ width: 60, height: 3, background: C.teal, borderRadius: 2, margin: "0 auto 40px" }} />
              <button
                onClick={() => navigate("/login")}
                className="fd-btn"
                style={{
                  fontFamily: F.display, fontSize: 16, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", padding: "16px 48px", borderRadius: 10,
                  background: C.teal, color: C.dark, border: "none", cursor: "pointer",
                  transition: "all 0.25s",
                }}
              >
                Get Started Now
              </button>
            </div>
          </div>
        </section>

        {/* ── BACK TO FEATURES ── */}
        <section style={{ padding: "60px 40px", textAlign: "center" }}>
          <button
            onClick={() => { navigate("/"); setTimeout(() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }), 100); }}
            style={{
              fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", padding: "12px 32px", borderRadius: 8,
              background: C.dark, color: C.teal, border: `1.5px solid ${C.tealBorder}`,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            &larr; Explore More Features
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
