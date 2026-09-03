import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar";
import { getPageNumber, PageBadge, DirectoryOverlay } from "../components/Directory";
import Scorecards from "../components/Scorecards";
import AgingTable from "../components/AgingTable";
import DetailPanel from "../components/DetailPanel";
import InvoicesTab from "./InvoicesTab";
import CFFTab from "./CFFTab";
import HealthCheckTab from "./HealthCheckTab";
import ActionPlanTab from "./ActionPlanTab";
import TriageTab from "./TriageTab";
import { useAR } from "../lib/ARContext";
import CashBasisBanner from "../components/CashBasisBanner";
import { exportAgingView, exportInvoicesView, exportHealthView, exportActionView, exportCFFView, exportAcctReviewView } from "../lib/exportUtils";

// The six real tab ids (URL source of truth). The Directory passes chapter ids
// (Directory.jsx → ch.id) that include non-tab values like "upload" — guard
// against those so a chapter click never lands on a routeless /ar/<junk> tab.
const TAB_IDS = ["triage", "aging", "action", "health", "cff", "invoices"];

export default function Dashboard() {
  const ar = useAR();
  const { tab } = useParams();
  const navigate = useNavigate();
  // useParams can be undefined (bare /ar routed via ARLayout); the old
  // useState("triage") always had a value — the ?? restores that guarantee so
  // the Export button + Topbar labels never no-op.
  const activeTab = tab ?? "triage";
  const goTab = (id) => navigate("/ar/" + (TAB_IDS.includes(id) ? id : "triage"));
  const [currentFilter, setCurrentFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("total");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showDirectory, setShowDirectory] = useState(false);

  const filtered = ar.getFiltered(currentFilter, searchTerm, sortBy, sortDir);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const handleExport = () => {
    if (activeTab === "triage") exportAcctReviewView(ar);
    else if (activeTab === "aging") exportAgingView(ar, currentFilter, searchTerm, sortBy, sortDir);
    else if (activeTab === "invoices") exportInvoicesView(ar.allInvoices);
    else if (activeTab === "cff") exportCFFView(ar);
    else if (activeTab === "health") exportHealthView(ar);
    else if (activeTab === "action") exportActionView(ar);
  };

  // Open detail panel from an invoice object (finds the customer first)
  const openDetailForInvoice = (inv) => {
    const cust = ar.customers.find((c) => c.name === inv.customer);
    if (cust) setSelectedCustomer(cust);
  };

  return (
    <div>
      <Topbar activeTab={activeTab} onTabChange={goTab} onExport={handleExport} />
      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "20px 16px", position: "relative", zIndex: 1 }}>
        {(activeTab === "triage" || activeTab === "action") && <CashBasisBanner />}
        {activeTab === "triage" && <TriageTab />}
        {activeTab === "aging" && (
          <>
            <Scorecards currentFilter={currentFilter} onFilterChange={setCurrentFilter} />
            <input type="text" placeholder="Search customers..." value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", maxWidth: 340, padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(28,24,20,0.22)", background: "#a89b88", fontSize: 13, color: "#2d2720", marginBottom: 12 }} />
            <AgingTable filtered={filtered} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} onSelectCustomer={setSelectedCustomer} />
          </>
        )}
        {activeTab === "invoices" && <InvoicesTab onSelectInvoice={openDetailForInvoice} />}
        {activeTab === "cff" && <CFFTab onSelectInvoice={openDetailForInvoice} />}
        {activeTab === "health" && <HealthCheckTab onSelectCustomer={setSelectedCustomer} />}
        {activeTab === "action" && <ActionPlanTab onSelectCustomer={setSelectedCustomer} onSelectInvoice={openDetailForInvoice} />}
      </div>

      {selectedCustomer && (
        <DetailPanel customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
      )}

      <PageBadge pageNumber={getPageNumber(activeTab)} onClick={() => setShowDirectory(true)} />
      {showDirectory && (
        <DirectoryOverlay
          onClose={() => setShowDirectory(false)}
          currentPageId={getPageNumber(activeTab)}
          onNavigate={goTab}
        />
      )}
    </div>
  );
}
