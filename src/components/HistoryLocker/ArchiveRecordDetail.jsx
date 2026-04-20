import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { C, F } from "../../lib/tokens";
import JOB_FOLDER_MAP from "./jobFolderMap";
import ImportToLiveWizard from "./ImportToLiveWizard";

export default function ArchiveRecordDetail({ record, onBack, onNavigateProposal, canImport }) {
  const raw = record.raw_data || {};
  const keys = Object.keys(raw).sort();
  const [attachments, setAttachments] = useState([]);
  const [loadingAtts, setLoadingAtts] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const fmtDate = v => v ? new Date(v + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  // Look up attachments using static job-number-to-folder mapping
  useEffect(() => {
    async function fetchAttachments() {
      setLoadingAtts(true);
      if (!record.legacy_id) { setLoadingAtts(false); return; }

      const numMatch = record.legacy_id.match(/^(\d{4,5})/);
      if (!numMatch) { setLoadingAtts(false); return; }
      const jobNum = numMatch[1];

      // Look up storage folder IDs from static map
      const folderIds = JOB_FOLDER_MAP[jobNum];
      if (!folderIds || folderIds.length === 0) { setLoadingAtts(false); return; }

      const allAtts = [];
      for (const folderId of folderIds) {
        const { data: files } = await supabase.storage
          .from("job-attachments")
          .list(String(folderId));
        if (files) {
          for (const file of files) {
            const { data: urlData } = supabase.storage
              .from("job-attachments")
              .getPublicUrl(`${folderId}/${file.name}`);
            const display = file.name.replace(/^\d+-/, "");
            allAtts.push({ name: display, url: urlData.publicUrl });
          }
        }
      }
      setAttachments(allAtts);
      setLoadingAtts(false);
    }
    fetchAttachments();
  }, [record.legacy_id]);

  const downloadCsv = () => {
    const headers = keys.join(",");
    const values = keys.map(k => {
      const v = String(raw[k] ?? "").replace(/"/g, '""');
      return `"${v}"`;
    }).join(",");
    const csv = headers + "\n" + values;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `archive-${record.legacy_id || record.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Top bar: Back + Import */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <button onClick={onBack} style={{
          padding: "7px 18px", borderRadius: 20, border: `1.5px solid ${C.tealBorder}`,
          background: C.dark, color: C.teal, fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          &larr; Back to Search
        </button>
        {canImport && record.record_type === "call_log" && (
          <button onClick={() => setShowImport(true)} style={{
            padding: "8px 22px", borderRadius: 7, border: "none",
            background: C.teal, color: C.dark, fontSize: 12.5, fontWeight: 800,
            cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Import to Live →
          </button>
        )}
      </div>
      {showImport && (
        <ImportToLiveWizard
          record={record}
          onClose={() => setShowImport(false)}
          onSaved={() => {
            setShowImport(false);
          }}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", margin: 0 }}>
          {record.legacy_id && <span style={{ background: C.dark, color: C.teal, padding: "2px 10px", borderRadius: 6, fontSize: 18, marginRight: 8 }}>{record.legacy_id}</span>}
          {record.customer_name || "Archived Record"}
        </h2>
        {record.job_name && (
          <div style={{ fontSize: 14, color: C.textMuted, fontFamily: F.ui, marginTop: 4 }}>{record.job_name}</div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {record.record_type && (
            <span style={{ background: C.dark, color: C.teal, padding: "3px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {record.record_type}
            </span>
          )}
          {record.source_system && (
            <span style={{ background: C.linenDeep, color: C.textMuted, padding: "3px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {record.source_system}
            </span>
          )}
          {record.status && (
            <span style={{ background: C.linenDeep, color: C.textBody, padding: "3px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {record.status}
            </span>
          )}
        </div>
      </div>

      {/* Attachments */}
      <div style={{ marginBottom: 24 }}>
        <div style={fieldLabel}>Attachments</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {loadingAtts && (
            <span style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading attachments...</span>
          )}
          {!loadingAtts && attachments.map(att => (
            <a
              key={att.url}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: C.dark, color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", padding: "6px 14px", borderRadius: 6, textDecoration: "none", display: "inline-block" }}
            >
              {att.name}
            </a>
          ))}
          {!loadingAtts && attachments.length === 0 && (
            <span style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>No attachments</span>
          )}
        </div>
      </div>

      {/* Summary fields */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 28,
        background: C.linenCard, borderRadius: 10, padding: 20, border: `1px solid ${C.borderStrong}`,
      }}>
        {record.job_address && (
          <div>
            <div style={fieldLabel}>Address</div>
            <div style={fieldValue}>{record.job_address}</div>
          </div>
        )}
        {record.record_date && (
          <div>
            <div style={fieldLabel}>Date</div>
            <div style={fieldValue}>{fmtDate(record.record_date)}</div>
          </div>
        )}
        {record.amount != null && (
          <div>
            <div style={fieldLabel}>Amount</div>
            <div style={fieldValue}>${Number(record.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
          </div>
        )}
      </div>

      {/* Raw data */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", margin: 0 }}>
          Original Record Data
        </h3>
        <button onClick={downloadCsv} style={{
          padding: "5px 14px", borderRadius: 6, border: `1px solid ${C.borderStrong}`,
          background: C.linenCard, color: C.textBody, fontSize: 11.5, fontWeight: 600,
          cursor: "pointer", fontFamily: F.ui,
        }}>
          Download CSV
        </button>
      </div>

      <div style={{
        borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden",
        boxShadow: "0 2px 10px rgba(28,24,20,0.08)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
          <thead>
            <tr style={{ background: C.dark }}>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Value</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k, i) => (
              <tr key={k} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                <td style={{ padding: "8px 15px", fontWeight: 600, color: C.textMuted, width: 220, verticalAlign: "top" }}>{k}</td>
                <td style={{ padding: "8px 15px", color: C.textBody, wordBreak: "break-word" }}>
                  {raw[k] != null ? String(raw[k]) : <span style={{ color: C.textFaint, fontStyle: "italic" }}>empty</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5,
  color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em",
  borderBottom: `1px solid rgba(255,255,255,0.10)`,
};
const fieldLabel = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: C.textFaint, fontFamily: F.display, marginBottom: 6,
};
const fieldValue = {
  fontSize: 14, color: C.textBody, fontFamily: F.ui,
};
