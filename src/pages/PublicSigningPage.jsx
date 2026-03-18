import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

const T = {
  green: "#30cfac",
  gray200: "rgba(28,24,20,0.12)",
  gray400: "#887c6e",
  gray500: "#6b6358",
  gray700: "#2d2720",
  gray900: "#1c1814",
};

const gvLink = document.createElement("link");
gvLink.rel = "stylesheet";
gvLink.href = "https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap";
document.head.appendChild(gvLink);

export default function PublicSigningPage() {
  const { token } = useParams();
  const [proposal, setProposal] = useState(null);
  const [wtc, setWtc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: prop, error: propErr } = await supabase
        .from("proposals")
        .select("*, call_log(job_name, display_job_number, customer_name)")
        .eq("signing_token", token)
        .single();

      if (propErr || !prop) { setError("Proposal not found."); setLoading(false); return; }
      if (prop.status === "Sold") { setSigned(true); setProposal(prop); setLoading(false); return; }

      const { data: wtcData } = await supabase
        .from("proposal_wtc")
        .select("sales_sow, discount, materials, travel, regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate, tax_rate")
        .eq("proposal_id", prop.id)
        .order("created_at", { ascending: true });

      setProposal(prop);
      setWtc(wtcData || []);
      setLoading(false);
    }
    load();
  }, [token]);

  async function handleSign() {
    if (name.trim().length <= 2 || signing) return;
    setSigning(true);
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json").catch(() => ({ json: async () => ({ ip: "unknown" }) }));
      const { ip } = await ipRes.json();

      // Generate PDF
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 48;
      const contentW = pageW - margin * 2;
      let y = 48;

      // Header
      doc.setFontSize(18); doc.setFont("helvetica", "bold");
      doc.text("High Desert Surface Prep", margin, y); y += 22;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.text("Industrial & Commercial Concrete Coatings", margin, y); y += 30;

      // Job info
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text(proposal.call_log?.customer_name || "", margin, y); y += 18;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.text(proposal.call_log?.job_name || proposal.call_log?.display_job_number || "", margin, y); y += 30;

      // SOW
      doc.setFontSize(9); doc.setFont("helvetica", "bold");
      doc.text("SCOPE OF WORK", margin, y); y += 14;
      doc.setFont("helvetica", "normal");
      const sowLines = doc.splitTextToSize(combinedSow || "No scope of work provided.", contentW);
      sowLines.forEach(line => {
        if (y > 700) { doc.addPage(); y = 48; }
        doc.text(line, margin, y); y += 13;
      });
      y += 16;

      // Total
      doc.setFontSize(12); doc.setFont("helvetica", "bold");
      doc.text("Total Investment: " + fmt(proposal.total || 0), margin, y); y += 30;

      // Signature block
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text("Electronically signed by: " + name.trim(), margin, y); y += 14;
      doc.text("Date: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), margin, y); y += 14;
      doc.text("IP Address: " + ip, margin, y); y += 14;
      doc.setFont("helvetica", "italic");
      doc.text("This electronic signature is legally binding.", margin, y);

      const pdfBlob = doc.output("blob");
      const fileName = "signed-proposal-" + proposal.id + "-" + Date.now() + ".pdf";

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("signed-proposals")
        .upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: false });

      let pdfUrl = null;
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from("signed-proposals").getPublicUrl(fileName);
        pdfUrl = urlData?.publicUrl || null;
      }

      // Save signature record
      await supabase.from("proposal_signatures").insert({
        proposal_id: proposal.id,
        signer_name: name.trim(),
        signer_email: null,
        ip_address: ip,
        pdf_url: pdfUrl,
      });

      await supabase.from("proposals").update({ status: "Sold" }).eq("id", proposal.id);

      setSigned(true);
    } catch (e) {
      console.error(e);
      alert("Something went wrong. Please try again.");
    }
    setSigning(false);
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F0F4FF", fontFamily: "sans-serif", fontSize: 14, color: "#888" }}>
      Loading proposal…
    </div>
  );

  if (error) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F0F4FF", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1814" }}>{error}</div>
      </div>
    </div>
  );

  const jobName = proposal.call_log?.job_name || proposal.call_log?.display_job_number || "Proposal";
  const customerName = proposal.call_log?.customer_name || "";
  const total = proposal.total || 0;
  const fmt = n => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const combinedSow = (wtc || []).map(w => w.sales_sow).filter(Boolean).join("\n\n");

  return (
    <div style={{ minHeight: "100vh", background: "#F0F4FF", fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: `1px solid ${T.gray200}`, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.gray900 }}>High Desert Surface Prep</div>
          <div style={{ fontSize: 12, color: T.gray500 }}>Industrial &amp; Commercial Concrete Coatings</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.green }}>{fmt(total)}</div>
      </div>

      <div style={{ maxWidth: 680, margin: "32px auto", padding: "0 20px" }}>

        {/* Job info */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: T.gray500, marginBottom: 4 }}>Proposal for</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.gray900 }}>{customerName}</div>
          <div style={{ fontSize: 13, color: T.gray400 }}>{jobName}</div>
        </div>

        {/* SOW */}
        <div style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "28px 32px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Scope of Work</div>
          {combinedSow
            ? <pre style={{ margin: 0, fontSize: 13, color: T.gray700, lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{combinedSow}</pre>
            : <div style={{ fontSize: 13, color: T.gray400, fontStyle: "italic" }}>No scope of work provided.</div>
          }
        </div>

        {/* Total */}
        <div style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "20px 28px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.gray700 }}>Total Investment</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: T.green }}>{fmt(total)}</div>
          </div>
        </div>

        {/* Signing */}
        {!signed ? (
          <div style={{ background: "white", borderRadius: 14, border: `2px solid ${T.green}`, padding: "28px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.gray900, marginBottom: 6 }}>Accept &amp; Sign</div>
            <div style={{ fontSize: 13, color: T.gray500, marginBottom: 20 }}>Type your full name below to electronically sign and accept this proposal.</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Full Name</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your full name"
                style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "10px 14px", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                onFocus={e => e.target.style.borderColor = T.green}
                onBlur={e => e.target.style.borderColor = T.gray200}
              />
            </div>
            {name.trim().length > 2 && (
              <div style={{ marginBottom: 16, padding: "14px 18px", background: "#F0F4FF", borderRadius: 8, border: `1px solid ${T.green}30` }}>
                <div style={{ fontSize: 11, color: T.gray400, marginBottom: 6 }}>Signature preview</div>
                <div style={{ fontSize: 38, color: "#1E40AF", fontFamily: "'Great Vibes', cursive" }}>{name}</div>
              </div>
            )}
            <button
              onClick={handleSign}
              disabled={name.trim().length <= 2 || signing}
              style={{ width: "100%", background: name.trim().length > 2 ? T.green : T.gray200, color: name.trim().length > 2 ? "white" : T.gray400, border: "none", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: name.trim().length > 2 ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.2s", marginBottom: 12 }}
            >
              {signing ? "Saving…" : name.trim().length > 2 ? `✍️ Accept & Sign as "${name}"` : "Type your name above to sign"}
            </button>
            <div style={{ fontSize: 11, color: T.gray400, textAlign: "center", lineHeight: 1.6 }}>
              By signing you agree this constitutes a legal electronic signature.<br />Timestamp and IP address will be recorded.
            </div>
          </div>
        ) : (
          <div style={{ background: "white", borderRadius: 14, border: `2px solid ${T.green}`, padding: "40px 32px", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.gray900, marginBottom: 8 }}>Proposal Accepted</div>
            <div style={{ fontSize: 13, color: T.gray500 }}>Thank you! Your signature has been recorded.</div>
          </div>
        )}

        <div style={{ marginTop: 32, textAlign: "center", fontSize: 11, color: T.gray400 }}>
          This proposal is valid for 90 days. · High Desert Surface Prep · hdspnv.com
        </div>
      </div>
    </div>
  );
}
