// AlertsProvider — owns the ONE shared Follow-Up snapshot (docs/plans/home-follow-up-screen.md §2.5).
//
// Mounts inside TenantConfigProvider but OUTSIDE <BrowserRouter> (App.jsx), so
// it uses NO router hooks (B1). Home + the footer consume the snapshot; the
// cross-screen banner consumes `count`. Refetches on mount and on tab refocus
// (N12 backstop — also fixes the overnight day-rollover gap). A refresh over an
// existing snapshot keeps the last snapshot visible — no flash-to-empty (P8).

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { loadSnapshot, bidDueAlerts, dormantCustomers, goneQuietBids, footerStats } from "./followUp";
import { useTenantConfig } from "./TenantConfigContext";

const AlertsContext = createContext(null);

export function AlertsProvider({ displayName = "", displayRole = "", children }) {
  const [snapshot, setSnapshot] = useState(null); // null until first successful load (P8)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cfg = useTenantConfig();
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // coalesce overlapping refreshes
    inFlight.current = true;
    setLoading(true);
    try {
      const snap = await loadSnapshot();
      if (snap.status === "error") {
        setError(snap.error || { message: "Couldn't load follow-up data" });
        // keep the last good snapshot (P8) — a failed refresh must not blank the screen
      } else {
        setSnapshot(snap);
        setError(null);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const isRep = !["Admin", "Manager"].includes(displayRole);

  const derived = useMemo(() => {
    if (!snapshot) return { count: 0, bidDueAlerts: [], dormant: [], goneQuiet: [], footerStats: null };
    const alerts = bidDueAlerts(snapshot, { displayName, isRep });
    return {
      count: alerts.length,
      bidDueAlerts: alerts,
      dormant: dormantCustomers(snapshot),
      goneQuiet: goneQuietBids(snapshot),
      footerStats: footerStats(snapshot, { monthlyGoal: cfg.monthly_billing_goal }),
    };
  }, [snapshot, displayName, isRep, cfg.monthly_billing_goal]);

  const value = useMemo(() => ({
    ...derived,
    snapshot, // raw shared snapshot — Home derives its own rep-scoped engagement figures
    loading,
    error,
    hasSnapshot: !!snapshot,
    firstLoadError: !!error && !snapshot, // the only state that warrants a blocking "couldn't load — retry"
    refresh,
  }), [derived, snapshot, loading, error, refresh]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used within AlertsProvider");
  return ctx;
}
