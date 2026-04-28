import { useState, useEffect, useCallback } from "react";
import { supabase, archiveDb } from "../../lib/supabase";
import { C, F } from "../../lib/tokens";
import DataTable from "../DataTable";
import ArchiveRecordDetail from "./ArchiveRecordDetail";

const PAGE_SIZE = 50;

const inputStyle = {
  padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 12.5, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", minWidth: 0,
};
const selectStyle = { ...inputStyle, cursor: "pointer" };
const labelStyle = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: C.textFaint, fontFamily: F.display, marginBottom: 3,
};

export default function ArchiveSearchView({ tenantId, onNavigateProposal, canImport, onDetailChange }) {
  const [q, setQ] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [recordType, setRecordType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => { onDetailChange?.(!!selected); }, [selected]);
  const [sources, setSources] = useState([]);
  const [types, setTypes] = useState([]);

  // Load filter options on mount (tenant-scoped DISTINCT via RPC)
  useEffect(() => {
    (async () => {
      const { data } = await archiveDb.rpc("get_filter_options");
      if (data) {
        setSources(data.sources || []);
        setTypes(data.types || []);
      }
    })();
  }, []);

  const search = useCallback(async (pageNum = 0) => {
    setLoading(true);
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = archiveDb
      .from("legacy_records")
      .select("*", { count: "exact" })
      .order("record_date", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (q.trim()) {
      query = query.textSearch("search_vector", q.trim().split(/\s+/).join(" & "), { type: "plain" });
    }
    if (sourceSystem) query = query.eq("source_system", sourceSystem);
    if (recordType) query = query.eq("record_type", recordType);
    if (dateFrom) query = query.gte("record_date", dateFrom);
    if (dateTo) query = query.lte("record_date", dateTo);

    const { data, count } = await query;
    setRows(data || []);
    setTotal(count || 0);
    setPage(pageNum);
    setLoading(false);
  }, [q, sourceSystem, recordType, dateFrom, dateTo]);

  // Search on mount and when filters change
  useEffect(() => { search(0); }, [sourceSystem, recordType, dateFrom, dateTo]);

  const handleSearch = (e) => {
    e.preventDefault();
    search(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const cols = [
    { k: "legacy_id", l: "ID", r: v => v ? (
      <span style={{ background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 5, fontSize: 11.5, fontWeight: 700, fontFamily: F.display }}>{v}</span>
    ) : "—" },
    { k: "customer_name", l: "Customer", r: v => v || "—" },
    { k: "job_name", l: "Job / Description" },
    { k: "job_address", l: "Address" },
    { k: "record_type", l: "Type", r: v => (
      <span style={{ background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 5, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>{v}</span>
    )},
    { k: "record_date", l: "Date", r: v => v ? new Date(v + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—" },
    { k: "amount", l: "Amount", r: v => v != null ? `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—" },
    { k: "source_system", l: "Source", r: v => (
      <span style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>{v}</span>
    )},
  ];

  if (selected) {
    return <ArchiveRecordDetail record={selected} onBack={() => setSelected(null)} onNavigateProposal={onNavigateProposal} canImport={canImport} />;
  }

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, marginBottom: 16, maxWidth: 720 }}>
        <input
          placeholder="Search archived records..."
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontSize: 14, padding: "10px 16px" }}
        />
        <button type="submit" style={{
          padding: "10px 22px", borderRadius: 7, border: "none",
          background: C.teal, color: C.dark, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
        }}>
          Search
        </button>
      </form>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        {sources.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Source</span>
            <select value={sourceSystem} onChange={e => setSourceSystem(e.target.value)} style={{ ...selectStyle, width: 160 }}>
              <option value="">All Sources</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {types.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>Record Type</span>
            <select value={recordType} onChange={e => setRecordType(e.target.value)} style={{ ...selectStyle, width: 160 }}>
              <option value="">All Types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        </div>
        {(sourceSystem || recordType || dateFrom || dateTo) && (
          <button onClick={() => { setSourceSystem(""); setRecordType(""); setDateFrom(""); setDateTo(""); }}
            style={{
              padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`,
              background: "transparent", color: C.textMuted, fontSize: 11.5, fontWeight: 700,
              cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
            }}>
            Clear
          </button>
        )}
      </div>

      {/* Results count */}
      <div style={{ marginBottom: 10, fontSize: 12.5, color: C.textMuted, fontFamily: F.ui }}>
        {loading ? "Searching..." : `${total.toLocaleString()} record${total !== 1 ? "s" : ""} found`}
      </div>

      {/* Results table */}
      {rows.length > 0 && (
        <>
          <DataTable cols={cols} rows={rows} onRow={r => setSelected(r)} defaultSort={{ key: "record_date", dir: "desc" }} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
              <button disabled={page === 0} onClick={() => search(page - 1)}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: page === 0 ? "transparent" : C.linenCard, color: page === 0 ? C.textFaint : C.textBody, fontSize: 12, fontWeight: 600, cursor: page === 0 ? "default" : "pointer", fontFamily: F.ui, opacity: page === 0 ? 0.4 : 1 }}>
                Prev
              </button>
              <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
                Page {page + 1} of {totalPages}
              </span>
              <button disabled={page >= totalPages - 1} onClick={() => search(page + 1)}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: page >= totalPages - 1 ? "transparent" : C.linenCard, color: page >= totalPages - 1 ? C.textFaint : C.textBody, fontSize: 12, fontWeight: 600, cursor: page >= totalPages - 1 ? "default" : "pointer", fontFamily: F.ui, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: C.textFaint, fontFamily: F.ui, fontSize: 14 }}>
          {q || sourceSystem || recordType || dateFrom || dateTo
            ? "No records match your search."
            : "No archived records yet. Use the Import tool to add historical data."}
        </div>
      )}
    </div>
  );
}
