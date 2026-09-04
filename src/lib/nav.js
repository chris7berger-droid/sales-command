// Canonical navigation model for the Subcon Command shell (Phase 1).
// ONE source read by the Sidebar, the header breadcrumb, the route guard, and
// Subcon Home — no drifting twin (feedback_extend_canonical_not_twin).

export const SUBCON_HEADER = "SUBCON COMMAND"; // sidebar wordmark: SUBCON white / COMMAND teal

// Which app groups are actually mounted THIS phase. Grow by one line per phase.
// Phase 1 → ["sales"]; Phase 2 → +"schedule"; Phase 3 → +"field"; Phase 4 → +"ar".
export const AVAILABLE_APPS = ["sales", "schedule", "field", "ar"];

export const GROUPS = [
  { app: "sales", label: "Sales Command", prefix: "/sales", home: "/sales/home", icon: "🧾", items: [
    { id: "home",      label: "Home",           path: "/sales/home",      icon: "⌂"  },
    { id: "calllog",   label: "Call Log",       path: "/sales/calllog",   icon: "📋" },
    { id: "proposals", label: "Proposals",      path: "/sales/proposals", icon: "📄" },
    { id: "leads",     label: "Campaign Leads", path: "/sales/leads",     icon: "🎯", flag: "leads_enabled" },
    { id: "invoices",  label: "Invoices",       path: "/sales/invoices",  icon: "💵" },
    { id: "managers",  label: "Managers",       path: "/sales/managers",  icon: "🏆", roles: ["Manager"] },
    { id: "customers", label: "Customers",      path: "/sales/customers", icon: "🏢" },
    { id: "team",      label: "Our Team",       path: "/sales/team",      icon: "👥" },
    { id: "archive",   label: "History Locker", path: "/sales/archive",   icon: "🗄" },
    { id: "directory", label: "The Directory",  icon: "📖", action: "directory" }, // overlay, not a route
  ]},
  { app: "schedule", label: "Schedule Command", prefix: "/schedule", home: "/schedule/home", icon: "🗓", items: [
    { id: "home",           label: "Home",            path: "/schedule/home",            icon: "⌂"  },
    { id: "jobs",           label: "Jobs",            path: "/schedule/jobs",            icon: "🗂" },
    { id: "schedule",       label: "Crew Schedule",   path: "/schedule/schedule",        icon: "👷" }, // literal /schedule/schedule (§2a) — harmless
    { id: "calendar",       label: "Calendar",        path: "/schedule/calendar",        icon: "📅" },
    { id: "daily",          label: "Daily",           path: "/schedule/daily",           icon: "📆" },
    { id: "materials",      label: "Logistics",       path: "/schedule/materials",       icon: "🚚" }, // label/path mismatch (§2a)
    { id: "billing",        label: "Billing",         path: "/schedule/billing",         icon: "💵" },
    { id: "production-rate",label: "Production Rate",  path: "/schedule/production-rate", icon: "📈" },
    { id: "schedules",      label: "Schedules",       path: "/schedule/schedules",       icon: "📇" },
    { id: "import",         label: "Import",          path: "/schedule/import",          icon: "⇪" },
  ]},
  { app: "field",    label: "Field Command",    prefix: "/field",    home: "/field/today", icon: "👷", items: [
    { id: "today",     label: "Today",      path: "/field/today",     icon: "📆" },
    { id: "jobs",      label: "Jobs",       path: "/field/jobs",      icon: "🧱" },
    { id: "crews",     label: "Crews",      path: "/field/crews",     icon: "👷" },
    { id: "timeclock", label: "Time Clock", path: "/field/timeclock", icon: "⏱" },
    { id: "dailylogs", label: "Daily Logs", path: "/field/dailylogs", icon: "📓" },
    { id: "loadouts",  label: "Load-Outs",  path: "/field/loadouts",  icon: "📦" }, // opens Schedule's LoadOutModal — same component (Beat 1b)
  ]},
  { app: "ar", label: "AR Command", prefix: "/ar", home: "/ar/triage", icon: "💰", items: [
    { id: "triage",   label: "Triage",       path: "/ar/triage",   icon: "🩺" },
    { id: "aging",    label: "Dashboard",    path: "/ar/aging",    icon: "📊" }, // label ≠ id (§4a)
    { id: "action",   label: "Chase",        path: "/ar/action",   icon: "📞" }, // label ≠ id (§4a)
    { id: "health",   label: "Health Check", path: "/ar/health",   icon: "❤️" },
    { id: "cff",      label: "Cash Flow",    path: "/ar/cff",      icon: "💧" },
    { id: "invoices", label: "Invoices",     path: "/ar/invoices", icon: "🧾" },
  ]},
];

// [R1-D] The single visibility predicate — used by BOTH the sidebar group AND the Subcon Home quadrant
// (one source, no drift). Fail-OPEN to Sales-only when apps are missing (Phase 1 has one real app), so a
// not-yet-loaded/empty apps array never blanks the screen ([R1-A] — the Critical). Item-level roles/flag
// gating is applied SEPARATELY, per item, after the group passes.
export function groupVisible(group, { tenantApps, memberApps }) {
  const tApps = (tenantApps?.length ? tenantApps : ["sales"]);
  const mApps = (memberApps?.length ? memberApps : ["sales"]);
  return AVAILABLE_APPS.includes(group.app) && tApps.includes(group.app) && mApps.includes(group.app);
}

export const itemVisible = (item, role, cfg) =>
  (!item.roles || item.roles.includes(role)) && (!item.flag || cfg[item.flag]);

// Top of the list (above the groups) and bottom (below):
export const SUBCON_HOME = { id: "subcon-home", label: "Home", path: "/", icon: "◈" };
export const SETTINGS     = { id: "settings",   label: "Settings", path: "/settings", icon: "⚙", roles: ["Admin", "Manager"] };

// [R2-3] Map a URL pathname to the section id used for active-state, the page
// badge, and TOC. `/` → subcon-home; a path under a GROUPS[].prefix → its 2nd
// segment (the item id); everything else (top-level /settings, /import) → its
// 1st segment. The else-branch is REQUIRED — a naïve "always 2nd segment"
// returns undefined for single-segment top-level routes (blank breadcrumb).
export function sectionFromPath(pathname) {
  if (pathname === "/") return SUBCON_HOME.id;
  const segs = pathname.split("/").filter(Boolean);
  const inGroup = GROUPS.some(g => pathname === g.prefix || pathname.startsWith(g.prefix + "/"));
  if (inGroup) return segs[1] || segs[0];
  return segs[0] || SUBCON_HOME.id;
}

// The group whose prefix owns this path (for the breadcrumb "‹Group› › ‹Item›").
// Null for top-level routes (/settings, /import) and Subcon Home.
export function groupFromPath(pathname) {
  return GROUPS.find(g => pathname === g.prefix || pathname.startsWith(g.prefix + "/")) || null;
}

// [R1-E] One resolver over ALL three nav sources — GROUPS items + SETTINGS +
// SUBCON_HOME — so a lookup by section id resolves Settings and Home too (a
// GROUPS-only lookup sends them to navigate("/undefined")). Returns { label, path }.
export function resolveNavTarget(id) {
  if (id === SUBCON_HOME.id) return SUBCON_HOME;
  if (id === SETTINGS.id) return SETTINGS;
  for (const g of GROUPS) {
    const item = g.items.find(it => it.id === id);
    if (item) return item;
  }
  return null;
}
