import { createContext, useContext, useEffect, useState } from "react";
import { getTenantConfig, refreshTenantConfig, DEFAULTS } from "./config";

const TenantConfigContext = createContext({ ...DEFAULTS });

export function TenantConfigProvider({ children }) {
  const [config, setConfig] = useState({ ...DEFAULTS });

  useEffect(() => {
    getTenantConfig().then(setConfig);
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
