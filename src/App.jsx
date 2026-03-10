import { useState } from "react";
import { C, F, GLOBAL_CSS } from "./lib/tokens";
import { SalesCommandMark, AppWordmark } from "./components/Logo";
import Home from "./pages/Home";
import CallLog from "./pages/CallLog";
import Proposals from "./pages/Proposals";
import Invoices from "./pages/Invoices";
import Managers from "./pages/Managers";
import Customers from "./pages/Customers";
import Team from "./pages/Team";

const NAV = [
  { id: "home",      label: "Home",       icon: "⌂"  },
  { id: "calllog",   label: "Call Log",   icon: "📋" },
  { id: "proposals", label: "Proposals",  icon: "📄" },
  { id: "invoices",  label: "Invoices",   icon: "💵" },
  { id: "dashboard", label: "Sales Dash", icon: "📊" },
  { id: "managers",  label: "Managers",   icon: "🏆" },
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
  const [active, setActive] = useState("home");
  const [open, setOpen]     = useState(true);

  const page = () => {
    switch (active) {
      case "home":      return <Home />;
      case "calllog":   return <CallLog />;
      case "proposals": return <Proposals />;
      case "invoices":  return <Invoices />;
      case "managers":  return <Managers />;
      case "customers": return <Customers />;
      case "team":      return <Team />;
      default:          return <Placeholder label={NAV.find(n => n.id === active)?.label || active} />;
    }
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ display: "flex", height: "100vh", background: C.linen, overflow: "hidden" }}>

        {/* Sidebar */}
        <div style={{ width: open ? 228 : 56, flexShrink: 0, background: C.dark, display: "flex", flexDirection: "column", transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", borderRight: `1px solid ${C.darkBorder}` }}>

          <div style={{ padding: open ? "18px 16px 14px" : "18px 10px 14px", borderBottom: `1px solid ${C.darkBorder}`, display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
            <div style={{ flexShrink: 0 }}><SalesCommandMark size={34} /></div>
            {open && <AppWordmark size={13} />}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 5px" }}>
            {NAV.map(n => {
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
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.tealGlow, border: `1.5px solid ${C.tealBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 900, color: C.teal, flexShrink: 0, fontFamily: F.display }}>JK</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.82)", fontFamily: F.display, letterSpacing: "0.04em" }}>Jordan Kim</div>
                  <div style={{ fontSize: 10.5, color: C.teal, fontFamily: F.ui, opacity: 0.65 }}>Manager</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ height: 50, background: C.linenCard, borderBottom: `1px solid ${C.borderStrong}`, display: "flex", alignItems: "center", padding: "0 28px", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.display }}>Sales Command</span>
              <span style={{ color: C.border, fontSize: 14 }}>›</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.textHead, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.display }}>{NAV.find(n => n.id === active)?.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>React · Supabase · DocuSeal · Stripe</span>
              <span style={{ background: C.tealGlow, border: `1px solid ${C.tealBorder}`, color: C.tealDark, fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 20, fontFamily: F.display, letterSpacing: "0.08em" }}>SCAFFOLD v1.1</span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
            {page()}
          </div>
        </div>

      </div>
    </>
  );
}