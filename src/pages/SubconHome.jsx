import { useNavigate } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { GROUPS, groupVisible, itemVisible } from "../lib/nav";
import { useTenantConfig } from "../lib/TenantConfigContext";

// Subcon Command landing (`/`). One quadrant card per visible app group
// (groupVisible — same predicate as the sidebar, no drift). Phase 1 mounts only
// Sales, so only the Sales quadrant renders — no fake "coming soon" tiles. The
// 4-up look is the Phase-4 end state. No data/query wiring here (§1j): the card
// is a rich navigational entry into each app's own Home.
export default function SubconHome({ teamMember, displayRole }) {
  const navigate = useNavigate();
  const cfg = useTenantConfig();

  const visInputs = { tenantApps: cfg?.apps, memberApps: teamMember?.apps };
  const visibleGroups = GROUPS.filter(g => groupVisible(g, visInputs));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Subcon <span style={{ color: C.tealDark }}>Command</span>
        </div>
        <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.ui, marginTop: 4 }}>
          Your command center. Pick an app to get to work.
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "40px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🧭</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>No apps assigned yet</div>
          <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, marginTop: 6 }}>Ask your admin to give you access to a Command app.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 18 }}>
          {visibleGroups.map(group => {
            const items = group.items.filter(it => !it.action && itemVisible(it, displayRole, cfg || {}));
            return (
              <button
                key={group.app}
                onClick={() => navigate(group.home)}
                style={{ textAlign: "left", cursor: "pointer", background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 14, transition: "transform 0.12s, box-shadow 0.12s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(28,24,20,0.14)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 30 }}>{group.icon}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>{group.label}</span>
                  </div>
                  <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "4px 12px", fontSize: 11.5, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Enter →</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {items.map(it => (
                    <span key={it.id} style={{ fontSize: 11.5, fontWeight: 700, color: C.textMuted, fontFamily: F.ui, background: C.linenDeep, borderRadius: 5, padding: "3px 9px", letterSpacing: "0.02em" }}>
                      {it.label}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
