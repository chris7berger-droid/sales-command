import { createContext, useContext, useEffect, useState } from "react";
import { getTenantConfig, refreshTenantConfig, DEFAULTS } from "./config";
import { supabase } from "./supabase";

const TenantConfigContext = createContext({ ...DEFAULTS });

export function TenantConfigProvider({ children }) {
  const [config, setConfig] = useState({ ...DEFAULTS });

  // The provider sits above the auth gate, so its first read can happen while
  // still anonymous — when RLS hands back nothing. Re-read on every auth
  // transition so the real row lands once the user is signed in.
  useEffect(() => {
    getTenantConfig().then(setConfig);
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      getTenantConfig().then(setConfig);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  const refresh = async () => {
    const cfg = await refreshTenantConfig();
    setConfig(cfg);
  };

  return (
    <TenantConfigContext.Provider value={{ ...config, refresh }}>
      {children}
    </TenantConfigContext.Provider>
  );
}

export function useTenantConfig() {
  return useContext(TenantConfigContext);
}
