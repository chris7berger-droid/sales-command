import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PublicSigningPage from "./pages/PublicSigningPage";
import { C, F, GLOBAL_CSS } from "./lib/tokens";
import { supabase } from "./lib/supabase";
import { SalesCommandMark, AppWordmark } from "./components/Logo";
import { getSession, onAuthStateChange, signOut, getCurrentTeamMember } from "./lib/auth";
import Login from "./pages/Login";
import LandingPage from "./pages/LandingPage";
import FeatureDetailPage from "./pages/FeatureDetailPage";
import Home from "./pages/Home";
import CallLog from "./pages/CallLog";
import WTCCalculator from "./pages/WTCCalculator";
import Proposals from "./pages/Proposals";
import Invoices from "./pages/Invoices";
import Managers from "./pages/Managers";
import SalesDash from "./pages/SalesDash";
import Customers from "./pages/Customers";
import Team from "./pages/Team";
import RegressionTest from "./components/RegressionTest";
import InvoicePaidPage from "./pages/InvoicePaidPage";
import QBCallbackPage from "./pages/QBCallbackPage";

const NAV = [
  { id: "home",      label: "Home",       icon: "⌂"  },
  { id: "calllog",   label: "Call Log",   icon: "📋" },
  { id: "proposals", label: "Proposals",  icon: "📄" },
  { id: "invoices",  label: "Invoices",   icon: "💵" },
  { id: "dashboard", label: "Sales Dash", icon: "📊" },
  { id: "managers",  label: "Managers",   icon: "🏆", roles: ["Manager"] },
  { id: "jobs",      label: "Jobs",       icon: "🏗️" },
  { id: "customers", label: "Customers",  icon: "🏢" },
  { id: "team",      label: "Our Team",   icon: "👥" },
  { id: "feedback",  label: "Feedback",   icon: "💬" },
  
];

function Placeholder({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 14 }}>
      <div style={{ fontSize: 44 }}>🚧</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13.5, color: C.textFaint, fontFamily: F.ui }}>Coming in a future build phase</div>
    </div>
  );
}

export default function App() {
  const [active,     setActive]     = useState("home");
  const [bidDueFilter, setBidDueFilter] = useState(false);
  const [stageFilter, setStageFilter] = useState(null);
  const [initialProposal, setInitialProposal] = useState(null);
  const [open,       setOpen]       = useState(true);
  const [session,    setSession]    = useState(undefined);
  const [teamMember, setTeamMember] = useState(null);

  useEffect(() => {
    // If "Remember me" was unchecked, clear session on fresh tab open
    if (!sessionStorage.getItem("sc_session_only") && localStorage.getItem("sc_remember") === "false") {
      supabase.auth.signOut().then(() => setSession(null));
    } else {
      getSession().then(s => setSession(s ?? null));
    }

    const sub = onAuthStateChange(async (event, s) => {
      if (event === "PASSWORD_RECOVERY") {
        setSession(null);
        return;
      }
      setSession(s ?? null);
      if (s) {
        const member = await getCurrentTeamMember();
        setTeamMember(member);
      } else {
        setTeamMember(null);
      }
    });

    return () => sub.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f0f14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#4a4a6a", letterSpacing: "0.1em" }}>
        LOADING…
      </div>
    );
  }

  if (!session) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<><style>{GLOBAL_CSS}</style><Login /></>} />
          <Route path="/features/:slug" element={<FeatureDetailPage />} />
          <Route path="/sign/:token" element={<PublicSigningPage />} />
          <Route path="/invoice-paid" element={<InvoicePaidPage />} />
          <Route path="/qb/callback" element={<QBCallbackPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const displayName = teamMember?.name ?? session?.user?.email ?? "";
  const displayRole     = teamMember?.role      ?? "Member";
  const displayInitials = displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  const page = () => {
    switch (active) {
      case "home": return <Home displayName={displayName} displayRole={displayRole} setActive={setActive} setBidDueFilter={setBidDueFilter} onStageFilter={stage => { setStageFilter(stage); setActive("calllog"); }} />;
      case "sales-dash": return <SalesDash displayName={displayName} />;
      case "calllog":   return <CallLog teamMember={teamMember} bidDueFilter={bidDueFilter} onClearBidDueFilter={() => setBidDueFilter(false)} stageFilter={stageFilter} onClearStageFilter={() => setStageFilter(null)} onNewProposal={job => { setInitialProposal({ job }); setActive("proposals"); }} onNavigateProposal={id => { setInitialProposal({ openId: id }); setActive("proposals"); }} onNavigateInvoice={() => setActive("invoices")} />;
      case "proposals": return <Proposals teamMember={teamMember} initialProposal={initialProposal} onClearInitial={() => setInitialProposal(null)} />;
      case "invoices":  return <Invoices />;
      case "managers":  return displayRole === "Manager" ? <Managers /> : <Placeholder label="Managers" />;
      case "customers": return <Customers />;
      case "team":      return <Team />;
      case "wtc":       return <Placeholder label="WTC" />;
      default:          return <Placeholder label={NAV.find(n => n.id === active)?.label || active} />;
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign/:token" element={<PublicSigningPage />} />
        <Route path="/invoice-paid" element={<InvoicePaidPage />} />
        <Route path="/qb/callback" element={<QBCallbackPage />} />
        <Route path="*" element={
          <AppShell
            active={active} setActive={setActive}
            open={open} setOpen={setOpen}
            displayName={displayName} displayRole={displayRole}
            displayInitials={displayInitials} page={page}
          />
        } />
      </Routes>
    </BrowserRouter>
  );
}

function AppShell({ active, setActive, open, setOpen, displayName, displayRole, displayInitials, page }) {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ display: "flex", height: "100vh", background: C.linen, overflow: "hidden" }}>

        <div style={{ width: open ? 228 : 56, flexShrink: 0, background: C.dark, display: "flex", flexDirection: "column", transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", borderRight: `1px solid ${C.darkBorder}` }}>

          <div style={{ padding: open ? "18px 16px 14px" : "18px 10px 14px", borderBottom: `1px solid ${C.darkBorder}`, display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
            <div style={{ flexShrink: 0 }}><SalesCommandMark size={34} /></div>
            {open && <AppWordmark size={13} />}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 5px" }}>
            {NAV.filter(n => !n.roles || n.roles.includes(displayRole)).map(n => {
              const on = active === n.id;
              return (
                <button key={n.id} onClick={() => setActive(n.id)} title={n.label} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: open ? "8px 11px" : "8px 14px", borderRadius: 7, border: "none", background: on ? C.tealGlow : "transparent", color: on ? C.teal : "rgba(255,255,255,0.42)", cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s", fontFamily: F.display, borderLeft: on ? `2px solid ${C.teal}` : "2px solid transparent" }}
                  onMouseEnter={e => { if (!on) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.72)"; } }}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.42)"; } }}
                >
                  <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: "center" }}>{n.icon}</span>
                  {open && <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{n.label}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "8px 5px", borderTop: `1px solid ${C.darkBorder}`, flexShrink: 0 }}>
            <button onClick={() => setOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 11px", borderRadius: 7, border: "none", background: "transparent", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <span style={{ fontSize: 11 }}>{open ? "◀" : "▶"}</span>
              {open && <span>Collapse</span>}
            </button>
            {open && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 4px" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.tealGlow, border: `1.5px solid ${C.tealBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 900, color: C.teal, flexShrink: 0, fontFamily: F.display }}>{displayInitials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.82)", fontFamily: F.display, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
                  <div style={{ fontSize: 10.5, color: C.teal, fontFamily: F.ui, opacity: 0.65 }}>{displayRole}</div>
                  <button onClick={signOut} style={{ marginTop: 4, fontSize: 10, fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase", padding: 0 }}>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ height: 50, background: C.linenCard, borderBottom: `1px solid ${C.borderStrong}`, display: "flex", alignItems: "center", padding: "0 28px", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.display }}>Sales Command</span>
              <span style={{ color: C.border, fontSize: 14 }}>›</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.textHead, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.display }}>{NAV.find(n => n.id === active)?.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
             
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
            {page()}
          </div>
        </div>

      </div>
      <RegressionTest />
    </>
  );
}
