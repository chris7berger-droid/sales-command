import { useState, useEffect } from "react";
import { archiveDb } from "../../lib/supabase";
import { C, F } from "../../lib/tokens";

export default function ArchiveBatchManager({ tenantId }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await archiveDb
      .from("import_batches")
      .select("*")
      .order("imported_at", { ascending: false });
    setBatches(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (batch) => {
    if (!window.confirm(`Delete batch "${batch.source_label || batch.file_name}"? This will permanently remove ${batch.row_count} archived records.`)) return;

    // legacy_records cascade on delete, so just delete the batch
    const { error } = await archiveDb
      .from("import_batches")
      .delete()
      .eq("id", batch.id);

    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      load();
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: C.textFaint, fontFamily: F.ui }}>Loading batches...</div>;
  }

  if (batches.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: C.textFaint, fontFamily: F.ui, fontSize: 14 }}>
        No import batches yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden",
        boxShadow: "0 2px 10px rgba(28,24,20,0.08)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
          <thead>
            <tr style={{ background: C.dark }}>
              {["Source", "Type", "Label", "File", "Records", "Imported", ""].map(h => (
                <th key={h} style={{
                  padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5,
                  color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em",
                  borderBottom: `1px solid rgba(255,255,255,0.10)`, whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                <td style={tdStyle}>
                  <span style={{ background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 5, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {b.source_system}
                  </span>
                </td>
                <td style={tdStyle}>{b.record_type}</td>
                <td style={tdStyle}>{b.source_label || "—"}</td>
                <td style={tdStyle}>{b.file_name || "—"}</td>
                <td style={tdStyle}>{(b.row_count || 0).toLocaleString()}</td>
                <td style={tdStyle}>
                  {b.imported_at ? new Date(b.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button onClick={() => handleDelete(b)} style={{
                    padding: "4px 12px", borderRadius: 5, border: `1px solid ${C.red}`,
                    background: "transparent", color: C.red, fontSize: 11, fontWeight: 700,
                    cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
                  }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
        {batches.length} batch{batches.length !== 1 ? "es" : ""} — {batches.reduce((sum, b) => sum + (b.row_count || 0), 0).toLocaleString()} total records
      </div>
    </div>
  );
}

const tdStyle = { padding: "12px 15px", color: C.textBody, verticalAlign: "middle" };
