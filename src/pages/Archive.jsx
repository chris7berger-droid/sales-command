import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import ArchiveSearchView from "../components/HistoryLocker/ArchiveSearchView";
import ArchiveBatchManager from "../components/HistoryLocker/ArchiveBatchManager";
import ArchiveImportWizard from "../components/HistoryLocker/ArchiveImportWizard";

const TABS = [
  { id: "search", label: "Search" },
  { id: "import", label: "Import", roles: ["Admin"] },
  { id: "batches", label: "Import Batches", roles: ["Admin"] },
];

export default function Archive({ userRole }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("search");
  const [tenantId, setTenantId] = useState(null);
  const [viewingDetail, setViewingDetail] = useState(false);

  useEffect(() => {
    supabase.from("tenant_config").select("id").limit(1).single()
      .then(({ data }) => { if (data) setTenantId(data.id); });
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0 }}>
          History Locker
        </h1>
      </div>

      {/* Admin tabs — hidden when viewing a record's detail */}
      {userRole === "Admin" && !viewingDetail && (
        <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "7px 18px", borderRadius: 20,
              border: `1.5px solid ${tab === t.id ? C.teal : C.border}`,
              background: tab === t.id ? C.dark : "transparent",
              color: tab === t.id ? C.teal : C.textMuted,
              fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "search" && <ArchiveSearchView tenantId={tenantId} onNavigateProposal={id => navigate(`/proposals/${id}`)} canImport={userRole === "Admin" || userRole === "Manager"} onDetailChange={setViewingDetail} />}
      {tab === "import" && <ArchiveImportWizard tenantId={tenantId} onDone={() => setTab("search")} />}
      {tab === "batches" && <ArchiveBatchManager tenantId={tenantId} />}
    </div>
  );
}
