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
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!token || !uuidRe.test(token)) { setError("Invalid signing link."); setLoading(false); return; }

      const { data: prop, error: propErr } = await supabase
        .from("proposals")
        .select("*, call_log_id, call_log(job_name, display_job_number, customer_name)")
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

      // Generate branded PDF
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 48;
      const contentW = pageW - margin * 2;
      const teal = [48, 207, 172];
      const dark = [28, 24, 20];
      const gray = [106, 99, 88];
      let y = 48;

      // Header — company name
      doc.setFontSize(20); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text("High Desert Surface Prep", margin, y); y += 24;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text("Industrial & Commercial Concrete Coatings", margin, y); y += 10;

      // Teal header underline
      doc.setDrawColor(...teal);
      doc.setLineWidth(3);
      doc.line(margin, y + 4, pageW - margin, y + 4); y += 22;

      // Prepared for
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...gray);
      doc.text("PREPARED FOR", margin, y); y += 14;
      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text(proposal.call_log?.customer_name || proposal.customer || "", margin, y); y += 18;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text(proposal.call_log?.job_name || proposal.call_log?.display_job_number || "", margin, y); y += 28;

      // Divider
      doc.setDrawColor(220, 215, 210);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y); y += 20;

      // Scope of Work
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...gray);
      doc.text("SCOPE OF WORK", margin, y); y += 14;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.setTextColor(...dark);
      const sowText = combinedSow || "No scope of work provided.";
      const sowLines = doc.splitTextToSize(sowText, contentW);
      sowLines.forEach(line => {
        if (y > 680) { doc.addPage(); y = 48; }
        doc.text(line, margin, y); y += 14;
      });
      y += 20;

      // Total box
      doc.setDrawColor(...teal);
      doc.setLineWidth(2);
      doc.roundedRect(margin, y, contentW, 44, 4, 4, "S");
      doc.setFontSize(10); doc.setFont("helvetica", "bold");
      doc.setTextColor(...gray);
      doc.text("PROPOSAL TOTAL", margin + 16, y + 17);
      const totalStr = fmt(proposal.total || 0);
      doc.setFontSize(18); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      const totalW = doc.getTextWidth(totalStr);
      doc.text(totalStr, pageW - margin - 16 - totalW, y + 28);
      y += 64;

      // Divider
      doc.setDrawColor(220, 215, 210);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y); y += 20;

      // Signature label
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...gray);
      doc.text("CUSTOMER ACCEPTANCE", margin, y); y += 18;

      // Render cursive signature via canvas
      const canvas = document.createElement("canvas");
      canvas.width = 400; canvas.height = 80;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#1E40AF";
      ctx.font = "52px 'Great Vibes', cursive";
      ctx.fillText(name.trim(), 8, 60);
      const sigDataUrl = canvas.toDataURL("image/png");
      doc.addImage(sigDataUrl, "PNG", margin, y, 200, 40);
      y += 48;

      // Signature line
      doc.setDrawColor(...dark);
      doc.setLineWidth(0.75);
      doc.line(margin, y, margin + 220, y); y += 10;
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text("Authorized Signature", margin, y); y += 24;

      // Sig metadata
      doc.setFontSize(9);
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
      if (proposal.call_log_id) {
        await supabase.from("call_log").update({ stage: "Sold" }).eq("id", proposal.call_log_id);
      }

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
