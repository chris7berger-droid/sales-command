import { useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import QBLinkModal from "./QBLinkModal";

const QB_GREEN = "#2CA01C";

export default function QBActionModal({ job, onClose, onLinked, onSkipSync }) {
  const [view, setView] = useState("pick");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("qb-create-job", {
        body: { callLogId: job.id },
      });
      if (fnErr) {
        const detail = typeof fnErr === "object" ? (fnErr.message || JSON.stringify(fnErr)) : String(fnErr);
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.skipped) {
        setError("Skipped — this job is flagged to skip QB sync.");
        setCreating(false);
        return;
      }
      setSuccess(`Created "${data.jobName}" under "${data.parentName}" in QuickBooks`);
      setTimeout(() => {
        onLinked?.({ id: data.jobId, displayName: data.jobName });
        onClose?.();
      }, 1800);
    } catch (e) {
      setError(e.message || "Failed to create in QuickBooks.");
    }
    setCreating(false);
  }

  function handleSkip() {
    onSkipSync?.();
    onClose?.();
  }

  if (view === "link") {
    return (
      <QBLinkModal
        callLogId={job.id}
        currentQbCustomerId={job.qb_customer_id}
        onClose={() => setView("pick")}
        onLinked={(c) => {
          onLinked?.(c);
          onClose?.();
        }}
      />
    );
  }

  const actionBtn = {
    width: "100%", padding: "16px 20px", borderRadius: 10,
    border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep,
    cursor: "pointer", textAlign: "left", display: "flex",
    alignItems: "center", gap: 16, transition: "border-color 0.15s",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: "32px 32px 28px", width: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: QB_GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 900 }}>QB</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>QuickBooks</h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, marginBottom: 20, lineHeight: 1.5 }}>
          How would you like to connect this job to QuickBooks?
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            style={actionBtn}
            onClick={handleCreate}
            disabled={creating}
            onMouseEnter={e => { e.currentTarget.style.borderColor = QB_GREEN; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderStrong; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 8, background: QB_GREEN, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>+</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>
                {creating ? "Creating…" : "Create in QuickBooks"}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginTop: 2 }}>
                New customer & job — use this if they don't exist in QB yet
              </div>
            </div>
          </button>

          <button
            style={actionBtn}
            onClick={() => setView("link")}
            onMouseEnter={e => { e.currentTarget.style.borderColor = QB_GREEN; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderStrong; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 8, background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: C.teal, fontSize: 18 }}>⇄</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>Link to Existing</div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginTop: 2 }}>
                Search and match to a customer already in QuickBooks
              </div>
            </div>
          </button>

          <button
            style={actionBtn}
            onClick={handleSkip}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderStrong; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderStrong; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(28,24,20,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: C.textFaint, fontSize: 18 }}>⊘</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>Skip QB Sync</div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginTop: 2 }}>
                Don't sync this job — invoices stay in Sales Command only
              </div>
            </div>
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: "8px 12px", background: "rgba(229,57,53,0.12)", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12.5, color: C.red, fontFamily: F.ui }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ marginTop: 14, padding: "8px 12px", background: "rgba(67,160,71,0.14)", border: `1px solid ${C.green}`, borderRadius: 6, fontSize: 12.5, color: C.green, fontFamily: F.ui }}>
            {success}
          </div>
        )}
      </div>
    </div>
  );
}
