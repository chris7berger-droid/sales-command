import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { SalesCommandMark, AppWordmark } from "./Logo";
import { signOut } from "../lib/auth";
import {
  GROUPS, SUBCON_HOME, SETTINGS, groupVisible, itemVisible, groupFromPath,
} from "../lib/nav";

// The grouped Subcon Command sidebar (Phase 1). One accordion group open at a
// time, auto-expanded from the URL. [R2-1] Receives teamMember (for .apps) + cfg
// so groupVisible's member layer is real — without them the member gate silently
// no-ops (fail-open shows Sales always).
export default function AppSidebar({
  open, setOpen, displayName, displayRole, displayInitials, onOpenDirectory,
  teamMember, cfg,
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const visInputs = { tenantApps: cfg?.apps, memberApps: teamMember?.apps };
  const visibleGroups = GROUPS.filter(g => groupVisible(g, visInputs));

  // Which group's accordion is expanded. Seed + follow the URL: navigating into
  // a group's page opens that group.
  const urlGroup = groupFromPath(location.pathname);
  const [expanded, setExpanded] = useState(urlGroup?.app ?? visibleGroups[0]?.app ?? null);
  useEffect(() => {
    if (urlGroup && urlGroup.app !== expanded) setExpanded(urlGroup.app);
  }, [urlGroup?.app]);

  const onSubconHome = location.pathname === SUBCON_HOME.path;
  const onSettings = location.pathname === SETTINGS.path;
  const settingsVisible = !SETTINGS.roles || SETTINGS.roles.includes(displayRole);

  return (
    <div data-app-sidebar style={{ width: open ? 228 : 56, flexShrink: 0, background: C.dark, display: "flex", flexDirection: "column", transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", borderRight: `1px solid ${C.darkBorder}` }}>

      <div style={{ padding: open ? "18px 16px 14px" : "18px 10px 14px", borderBottom: `1px solid ${C.darkBorder}`, display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
        <div style={{ flexShrink: 0 }}><SalesCommandMark size={34} /></div>
        {open && <AppWordmark size={13} />}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 5px" }}>

        {/* Subcon Home — always at top */}
        <SidebarLeaf
          icon={SUBCON_HOME.icon} label={SUBCON_HOME.label} open={open} active={onSubconHome}
          onClick={() => navigate(SUBCON_HOME.path)}
        />

        {/* Empty-state: a member with a non-empty, non-Sales apps array sees no
            groups in Phase 1 (only Sales is mounted). Never a blank shell. */}
        {visibleGroups.length === 0 && open && (
          <div style={{ padding: "14px 12px", marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: "rgba(255,255,255,0.42)", fontFamily: F.ui }}>
            No apps assigned yet — ask your admin.
          </div>
        )}

        {/* App groups */}
        {visibleGroups.map(group => {
          const isOpen = expanded === group.app;
          const groupActive = groupFromPath(location.pathname)?.app === group.app;
          const routableItems = group.items.filter(it => itemVisible(it, displayRole, cfg || {}));
          return (
            <div key={group.app} style={{ marginTop: 4 }}>
              <button
                onClick={() => {
                  if (!open) { setOpen(true); setExpanded(group.app); return; }
                  setExpanded(prev => (prev === group.app ? null : group.app));
                }}
                title={group.label}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: open ? "8px 11px" : "8px 14px", borderRadius: 7, border: "none", background: "transparent", color: groupActive ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.5)", cursor: "pointer", textAlign: "left", fontFamily: F.display }}
                onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.82)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = groupActive ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.5)"; }}
              >
                <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: "center" }}>{group.icon}</span>
                {open && <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", whiteSpace: "nowrap", flex: 1 }}>{group.label}</span>}
                {open && <span style={{ fontSize: 10, opacity: 0.7 }}>{isOpen ? "▾" : "▸"}</span>}
              </button>

              {open && isOpen && routableItems.map(item => {
                const active = !item.action && location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.id}
                    onClick={() => item.action === "directory" ? onOpenDirectory() : navigate(item.path)}
                    title={item.label}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 11px 7px 22px", borderRadius: 7, border: "none", background: active ? C.tealGlow : "transparent", color: active ? C.teal : "rgba(255,255,255,0.42)", cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s", fontFamily: F.display, borderLeft: active ? `2px solid ${C.teal}` : "2px solid transparent" }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.72)"; } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.42)"; } }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0, width: 18, textAlign: "center" }}>{item.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* Settings — bottom, role-gated (Admin/Manager) */}
        {settingsVisible && (
          <div style={{ marginTop: 8 }}>
            <SidebarLeaf
              icon={SETTINGS.icon} label={SETTINGS.label} open={open} active={onSettings}
              onClick={() => navigate(SETTINGS.path)}
            />
          </div>
        )}
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
  );
}

// A top-level (non-group) nav row — Subcon Home and Settings. Reuses the item
// button style at the group level (no left indent).
function SidebarLeaf({ icon, label, open, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: open ? "8px 11px" : "8px 14px", borderRadius: 7, border: "none", background: active ? C.tealGlow : "transparent", color: active ? C.teal : "rgba(255,255,255,0.42)", cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all 0.12s", fontFamily: F.display, borderLeft: active ? `2px solid ${C.teal}` : "2px solid transparent" }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.72)"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.42)"; } }}
    >
      <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: "center" }}>{icon}</span>
      {open && <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>}
    </button>
  );
}
