// Cross-screen alerts banner (docs/plans/home-follow-up-screen.md §2.5).
// Slim sticky strip shown on every screen EXCEPT Home when there are bid-due
// alerts. Recolored to C.* tokens (dark bg + teal text) — the screenshot's white
// banner violates the no-white-bg rule (K12). Rendered inside AppShell, so it
// never reaches the public signing/invoice pages.
import { useLocation, useNavigate } from "react-router-dom";
import { useAlerts } from "../../lib/alerts";
import { C, F } from "../../lib/tokens";

export default function AlertsBanner() {
  const { count } = useAlerts();
  const loc = useLocation();
  const navigate = useNavigate();

  const onHome = loc.pathname === "/home" || loc.pathname === "/";
  if (onHome || !count) return null;

  return (
    <div
      onClick={() => navigate("/home")}
      style={{
        position: "sticky", top: 0, zIndex: 20, cursor: "pointer",
        background: C.dark, borderRadius: 8, padding: "10px 16px", marginBottom: 18,
        display: "flex", alignItems: "center", gap: 10, boxShadow: "0 2px 8px rgba(28,24,20,0.15)",
      }}
    >
      <span style={{ fontSize: 14 }}>⚠</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, fontFamily: F.ui, letterSpacing: "0.02em" }}>
        You have {count} bid{count > 1 ? "s" : ""} due — Take Action →
      </span>
    </div>
  );
}
