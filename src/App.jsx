import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import PublicSigningPage from "./pages/PublicSigningPage";
import { C, F, GLOBAL_CSS } from "./lib/tokens";
import { supabase } from "./lib/supabase";
import { getSession, onAuthStateChange, getCurrentTeamMember } from "./lib/auth";
import Login from "./pages/Login";
import LandingPage from "./pages/LandingPage";
import SubConCommandPage from "./pages/SubConCommandPage";
import FeatureDetailPage from "./pages/FeatureDetailPage";
import CheckoutPage from "./pages/CheckoutPage";
import Home from "./pages/Home";
import CallLog from "./pages/CallLog";
import Leads from "./pages/Leads";
import WTCCalculator from "./pages/WTCCalculator";
import Proposals from "./pages/Proposals";
import Invoices from "./pages/Invoices";
import Managers from "./pages/Managers";
import Customers from "./pages/Customers";
import Team from "./pages/Team";
import Settings from "./pages/Settings";
import SubconHome from "./pages/SubconHome";
import AppSidebar from "./components/AppSidebar";
import { getPageNumber, PageBadge, TOCOverlay } from "./components/TableOfContents";
import InvoicePaidPage from "./pages/InvoicePaidPage";
import PublicInvoicePage from "./pages/PublicInvoicePage";
import QBCallbackPage from "./pages/QBCallbackPage";
import ErrorBoundary from "./components/ErrorBoundary";
import WelcomeScreen from "./components/WelcomeScreen";
import RadarLoader from "./components/RadarLoader";
import { TenantConfigProvider, useTenantConfig } from "./lib/TenantConfigContext";
import { AlertsProvider } from "./lib/alerts";
import Import from "./pages/Import/Import";
import UpdateBanner from "./components/UpdateBanner";
import Archive from "./pages/Archive";
import { GROUPS, SUBCON_HOME, SETTINGS, groupVisible, sectionFromPath, groupFromPath, resolveNavTarget } from "./lib/nav";

function Placeholder({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 14 }}>
      <div style={{ fontSize: 44 }}>🚧</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13.5, color: C.textFaint, fontFamily: F.ui }}>Coming in a future build phase</div>
    </div>
  );
}

// "Not authorized" panel rendered INSIDE the shell (sidebar + header present) so
// the user keeps a way back — not the bare full-page dead-end /import uses.
function NotAuthorized() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 12 }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Not authorized</div>
      <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.ui, maxWidth: 380, textAlign: "center" }}>
        You don't have access to this app. Use the menu on the left to get back, or ask your admin for access.
      </div>
    </div>
  );
}

// [R1-A / R1-D] Route guard for an app group. Uses the SAME groupVisible fail-open
// predicate as the sidebar (§1a) — a naïve raw-apps read would fail CLOSED during
// the async load and block entitled users. Not-yet-available groups (/schedule/*
// in Phase 1) fail because AVAILABLE_APPS excludes them, which is correct.
function GroupGuard({ app, teamMember, children }) {
  const cfg = useTenantConfig();
  const group = GROUPS.find(g => g.app === app);
  const ok = group && groupVisible(group, { tenantApps: cfg?.apps, memberApps: teamMember?.apps });
  return ok ? children : <NotAuthorized />;
}

// Catch-all for authed paths that matched no explicit route. A URL under a known
// app-group prefix (e.g. /schedule/home) runs the guard so an unavailable group
// shows "Not authorized" instead of silently bouncing to Home (Beat 4 — hiding a
// group ≠ security); a stray /sales/* subpath redirects to the Sales home; any
// other unknown path goes to Subcon Home.
function UnmatchedRoute({ teamMember }) {
  const { pathname } = useLocation();
  const group = groupFromPath(pathname);
  if (group) {
    return (
      <GroupGuard app={group.app} teamMember={teamMember}>
        <Navigate to={group.home} replace />
      </GroupGuard>
    );
  }
  return <Navigate to="/" replace />;
}

// [R1-B] Redirect old flat Sales URLs to their /sales/* equivalent. Carries the
// FULL location — path param, query string, hash, AND React-Router state — so
// external bookmarks/emailed links survive. In-app links are repointed directly
// (Option B); this layer is for external links only.
function LegacyRedirect({ base }) {
  const { id } = useParams();
  const { search, hash, state } = useLocation();
  return <Navigate replace state={state} to={`/sales/${base}${id ? "/" + id : ""}${search}${hash}`} />;
}

const SCC_HOST = window.location.hostname.replace(/^www\./, "") === "sccmybiz.com";

export default function App() {
  if (SCC_HOST) {
    // /terms serves static HTML from public/terms.html
    if (window.location.pathname === "/terms") {
      window.location.href = "/terms.html";
      return null;
    }
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<SubConCommandPage />} />
        </Routes>
      </BrowserRouter>
    );
  }
  return <SalesCommandApp />;
}

// Minimum time the radar loader stays on screen during initial boot.
// Set to 0 to disable.
const BOOT_LOADER_MIN_MS = 3000;

function SalesCommandApp() {
  // Customer-facing public routes must skip the boot loader — a 3s radar
  // animation in the middle of a customer flow looks like an error to them.
  // Covers signing (/sign/:token), invoice viewing (/invoice/:token), and
  // post-payment landing (/invoice-paid).
  const path = window.location.pathname;
  const isCustomerFacingRoute =
    path.startsWith("/sign/") ||
    path.startsWith("/invoice/") ||
    path.startsWith("/invoice-paid");

  const [open,       setOpen]       = useState(true);
  const [showTOC,    setShowTOC]    = useState(false);
  const [subPage,    setSubPage]    = useState(null);
  const [session,    setSession]    = useState(undefined);
  const [teamMember, setTeamMember] = useState(undefined);
  const [bootMinElapsed, setBootMinElapsed] = useState(BOOT_LOADER_MIN_MS === 0 || isCustomerFacingRoute);

  useEffect(() => {
    if (BOOT_LOADER_MIN_MS === 0 || isCustomerFacingRoute) return;
    const t = setTimeout(() => setBootMinElapsed(true), BOOT_LOADER_MIN_MS);
    return () => clearTimeout(t);
  }, [isCustomerFacingRoute]);

  // Clean up stale hash fragments (leftover from Supabase auth redirects)
  useEffect(() => {
    const h = window.location.hash;
    if (h === "#" || h === "#/" || (h && !h.includes("type=recovery") && !h.includes("access_token"))) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    const sub = onAuthStateChange(async (event, s) => {
      // PASSWORD_RECOVERY: only drop to login if the URL has a real recovery hash
      if (event === "PASSWORD_RECOVERY") {
        const hasRecoveryHash = (window.location.hash || "").includes("type=recovery");
        if (hasRecoveryHash) {
          // Real recovery link clicked — stash flag for Login, then clear hash
          sessionStorage.setItem("sc_recovery_mode", "1");
          window.history.replaceState({}, "", window.location.pathname);
          setSession(null);
          return;
        }
        // Stale recovery event — set session normally so the user stays logged in
        // Stale PASSWORD_RECOVERY event — set session normally
      }
      if (event === "TOKEN_REFRESHED" && !s) {
        // Refresh token was rejected — force clean logout
        supabase.auth.signOut();
        setSession(null);
        setTeamMember(null);
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

    // If "Remember me" was unchecked, clear session on fresh tab open
    if (!sessionStorage.getItem("sc_session_only") && localStorage.getItem("sc_remember") === "false") {
      supabase.auth.signOut().then(() => setSession(null));
    } else {
      getSession().then(async (s) => {
        setSession(s ?? null);
        if (s) {
          const member = await getCurrentTeamMember();
          setTeamMember(member);
        }
      });
    }

    return () => sub.unsubscribe();
  }, []);

  if ((session === undefined || !bootMinElapsed) && !isCustomerFacingRoute) {
    return <><style>{GLOBAL_CSS}</style><RadarLoader /></>;
  }

  if (!session) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<><style>{GLOBAL_CSS}</style><Login /></>} />
          <Route path="/suite" element={<SubConCommandPage />} />
          <Route path="/features/:slug" element={<FeatureDetailPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/sign/:token" element={<PublicSigningPage />} />
          <Route path="/invoice-paid" element={<InvoicePaidPage />} />
          <Route path="/invoice/:token" element={<PublicInvoicePage />} />
          <Route path="/qb/callback" element={<QBCallbackPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  // Wait for team member data before rendering the app
  if ((teamMember === undefined || !bootMinElapsed) && !isCustomerFacingRoute) {
    return <><style>{GLOBAL_CSS}</style><RadarLoader /></>;
  }

  // Show welcome screen for newly invited users who haven't onboarded yet
  if (teamMember && teamMember.onboarded === false) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/sign/:token" element={<PublicSigningPage />} />
          <Route path="/invoice-paid" element={<InvoicePaidPage />} />
          <Route path="/invoice/:token" element={<PublicInvoicePage />} />
          <Route path="*" element={
            <WelcomeScreen
              teamMember={teamMember}
              onComplete={() => setTeamMember({ ...teamMember, onboarded: true })}
            />
          } />
        </Routes>
      </BrowserRouter>
    );
  }

  const displayName = teamMember?.name ?? session?.user?.email ?? "";
  // Clean rep name for per-rep scoping on Home (engagement redesign N1): NO email
  // fallback, because it seeds CallLog's `sales` filter — an email would match
  // zero salesOptions. Empty when the member has no name → rep-scoped figures
  // read empty rather than mis-attributing.
  const repName = teamMember?.name ?? "";
  const displayRole     = teamMember?.role      ?? "Member";
  const displayInitials = displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  const canManageSettings = displayRole === "Admin" || displayRole === "Manager";

  return (
    <TenantConfigProvider>
    <UpdateBanner />
    <AlertsProvider displayName={displayName} displayRole={displayRole}>
    <BrowserRouter>
      <Routes>
        <Route path="/suite" element={<SubConCommandPage />} />
        <Route path="/sign/:token" element={<PublicSigningPage />} />
        <Route path="/invoice-paid" element={<InvoicePaidPage />} />
        <Route path="/invoice/:token" element={<PublicInvoicePage />} />
        <Route path="/qb/callback" element={<QBCallbackPage />} />
        <Route path="/import" element={
          displayRole === "Admin"
            ? <><style>{GLOBAL_CSS}</style><Import /></>
            : <div style={{ minHeight: "100vh", background: C.linen, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.ui, color: C.textMuted }}>Not authorized</div>
        } />
        <Route path="*" element={
          <AppShell
            open={open} setOpen={setOpen}
            displayName={displayName} displayRole={displayRole}
            displayInitials={displayInitials}
            teamMember={teamMember}
            onOpenDirectory={() => setShowTOC(true)}
            showTOC={showTOC} setShowTOC={setShowTOC}
            subPage={subPage} setSubPage={setSubPage}
          >
            <Routes>
              {/* Subcon Command landing */}
              <Route path="/" element={<SubconHome teamMember={teamMember} displayRole={displayRole} />} />

              {/* Sales Command — group-guarded /sales/* */}
              <Route path="/sales/home" element={<GroupGuard app="sales" teamMember={teamMember}><Home displayName={displayName} displayRole={displayRole} repName={repName} /></GroupGuard>} />
              <Route path="/sales/calllog" element={<GroupGuard app="sales" teamMember={teamMember}><CallLog teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/calllog/:id" element={<GroupGuard app="sales" teamMember={teamMember}><CallLog teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/leads" element={<GroupGuard app="sales" teamMember={teamMember}><Leads teamMember={teamMember} /></GroupGuard>} />
              <Route path="/sales/proposals" element={<GroupGuard app="sales" teamMember={teamMember}><Proposals teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/proposals/:id" element={<GroupGuard app="sales" teamMember={teamMember}><Proposals teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/invoices" element={<GroupGuard app="sales" teamMember={teamMember}><Invoices teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/invoices/:id" element={<GroupGuard app="sales" teamMember={teamMember}><Invoices teamMember={teamMember} setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/customers" element={<GroupGuard app="sales" teamMember={teamMember}><Customers setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/customers/:id" element={<GroupGuard app="sales" teamMember={teamMember}><Customers setSubPage={setSubPage} /></GroupGuard>} />
              <Route path="/sales/managers" element={<GroupGuard app="sales" teamMember={teamMember}>{displayRole === "Manager" ? <Managers /> : <Placeholder label="Managers" />}</GroupGuard>} />
              <Route path="/sales/team" element={<GroupGuard app="sales" teamMember={teamMember}><Team teamMember={teamMember} /></GroupGuard>} />
              <Route path="/sales/archive" element={<GroupGuard app="sales" teamMember={teamMember}><Archive userRole={displayRole} /></GroupGuard>} />

              {/* Legacy flat Sales URLs → /sales/* (external bookmarks/emailed links) */}
              <Route path="/home" element={<LegacyRedirect base="home" />} />
              <Route path="/calllog" element={<LegacyRedirect base="calllog" />} />
              <Route path="/calllog/:id" element={<LegacyRedirect base="calllog" />} />
              <Route path="/leads" element={<LegacyRedirect base="leads" />} />
              <Route path="/proposals" element={<LegacyRedirect base="proposals" />} />
              <Route path="/proposals/:id" element={<LegacyRedirect base="proposals" />} />
              <Route path="/invoices" element={<LegacyRedirect base="invoices" />} />
              <Route path="/invoices/:id" element={<LegacyRedirect base="invoices" />} />
              <Route path="/customers" element={<LegacyRedirect base="customers" />} />
              <Route path="/customers/:id" element={<LegacyRedirect base="customers" />} />
              <Route path="/managers" element={<LegacyRedirect base="managers" />} />
              <Route path="/team" element={<LegacyRedirect base="team" />} />
              <Route path="/archive" element={<LegacyRedirect base="archive" />} />

              {/* Settings — global/top-level, [R1-C] Admin/Manager gate closes the pre-existing leak */}
              <Route path="/settings" element={canManageSettings ? <Settings userRole={displayRole} /> : <NotAuthorized />} />

              {/* Any unmatched authed path. If it's under a known app group
                  (/schedule/*, /field/*, /ar/* in Phase 1, or a stray /sales/*),
                  run the guard — not-yet-available groups render "Not authorized",
                  not a silent redirect (Beat 4). Everything else → Subcon Home.
                  Handled here rather than via a splat Route because a descendant
                  <Routes> under a parent path="*" doesn't reliably match a nested
                  splat on a fresh page load. */}
              <Route path="*" element={<UnmatchedRoute teamMember={teamMember} />} />
            </Routes>
          </AppShell>
        } />
      </Routes>
    </BrowserRouter>
    </AlertsProvider>
    </TenantConfigProvider>
  );
}

function AppShell({ open, setOpen, displayName, displayRole, displayInitials, teamMember, onOpenDirectory, showTOC, setShowTOC, subPage, setSubPage, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cfg = useTenantConfig();
  const active = sectionFromPath(location.pathname);
  const group = groupFromPath(location.pathname);
  const onSubconHome = location.pathname === SUBCON_HOME.path;
  const activeLabel = resolveNavTarget(active)?.label;
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div data-app-shell style={{ display: "flex", height: "100vh", background: C.linen, overflow: "hidden" }}>

        <AppSidebar
          open={open} setOpen={setOpen}
          displayName={displayName} displayRole={displayRole}
          displayInitials={displayInitials}
          teamMember={teamMember} cfg={cfg}
          onOpenDirectory={onOpenDirectory}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div data-app-header style={{ height: 50, background: C.linenCard, borderBottom: `1px solid ${C.borderStrong}`, display: "flex", alignItems: "center", padding: "0 28px", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {onSubconHome ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: C.textHead, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.display }}>Subcon Command Home</span>
              ) : group ? (
                <>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.display }}>{group.label}</span>
                  <span style={{ color: C.border, fontSize: 14 }}>›</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.textHead, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.display }}>{activeLabel}</span>
                </>
              ) : (
                // Top-level global routes (/settings, /import) aren't under an app
                // group — a single clean crumb, not the borrowed umbrella label.
                <span style={{ fontSize: 13, fontWeight: 800, color: C.textHead, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.display }}>{activeLabel}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

            </div>
          </div>
          <div data-app-content style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </div>

      </div>
      <PageBadge
        pageNumber={getPageNumber(active, subPage)}
        onClick={() => setShowTOC(true)}
      />
      {showTOC && (
        <TOCOverlay
          currentPageId={getPageNumber(active, subPage)}
          onClose={() => setShowTOC(false)}
          onNavigate={(chapterId) => {
            setSubPage(null);
            setShowTOC(false);
            const target = resolveNavTarget(chapterId);
            navigate(target?.path ?? "/");
          }}
        />
      )}
    </>
  );
}
