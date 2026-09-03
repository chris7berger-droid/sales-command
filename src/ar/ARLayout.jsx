// AR Command — content-level layout mounted under the host Subcon shell at /ar/*
// (Phase 4). Mirrors FieldLayout/ScheduleLayout: the host owns the sidebar,
// header, login, and entitlement; this layer owns AR's own Topbar/tabs, its
// localStorage-backed ARProvider, and its nested routes.
//
// Replaces AR's dropped App.jsx. Two deliberate departures from that original:
//  1. AR's full GLOBAL_CSS is NOT injected — the host reset already covers
//     */fonts/scrollbar/autofill/body-bg. The ONE thing the host lacks is a
//     `body::before` crosshatch, so AR's linen texture would render flat. We
//     keep JUST that, scoped to `.ar-root::before` (subtree-scoped, mirrors
//     `.schedule-root`) so it never repaints behind live Sales/Schedule/Field
//     pages. AR content already sits at z-index:1 above it, so it layers right.
//  2. Routing replaces AR's activeTab state — `/ar/:tab` is the single URL
//     source so AR's own Topbar and the host sidebar's GROUPS[ar].items
//     highlight in sync. Index + splat redirect to Triage (hardened default).
import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ARProvider, useAR } from "./lib/ARContext";
import Upload from "./pages/Upload";
import Dashboard from "./pages/Dashboard";

// Crosshatch linen texture — AR's body::before gradient stack, ported verbatim,
// re-anchored to the .ar-root subtree (position:absolute, not fixed).
const AR_CROSSHATCH_CSS = `
  .ar-root { position: relative; }
  .ar-root::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(60,50,35,0.04) 2px,rgba(60,50,35,0.04) 3px),
      repeating-linear-gradient(90deg,transparent,transparent 2px,rgba(60,50,35,0.04) 2px,rgba(60,50,35,0.04) 3px),
      radial-gradient(ellipse at 25% 15%,rgba(200,188,170,0.4) 0%,transparent 50%),
      radial-gradient(ellipse at 75% 85%,rgba(158,145,126,0.3) 0%,transparent 50%);
  }
`;

// Upload gate precedes routing: empty localStorage at /ar/health still shows
// Upload, not a blank routed screen. loadAll() hydrates from localStorage.
function ARInner() {
  const { customers, loaded, loadAll } = useAR();

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!loaded) return null;
  if (!customers.length) return <Upload />;

  return (
    <Routes>
      <Route index element={<Navigate to="triage" replace />} />
      <Route path=":tab" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="triage" replace />} />
    </Routes>
  );
}

export default function ARLayout({ teamMember }) {
  // teamMember accepted for signature uniformity with Field/Schedule layouts;
  // AR reads no user/tenant context today (client-local data) — passed-but-unused.
  void teamMember;
  return (
    <div className="ar-root">
      <style>{AR_CROSSHATCH_CSS}</style>
      <ARProvider>
        <ARInner />
      </ARProvider>
    </div>
  );
}
