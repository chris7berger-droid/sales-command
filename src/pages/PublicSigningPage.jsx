import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { createPublicClient } from "../lib/supabasePublic";
import { useMemo } from "react";
import { calcWtcPrice } from "../lib/calc";
import { getTenantConfig, DEFAULTS } from "../lib/config";

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
  const supabase = useMemo(() => createPublicClient({ signingToken: token }), [token]);
  const [proposal, setProposal] = useState(null);
  const [wtc, setWtc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [config, setConfig] = useState(DEFAULTS);
  const [pulledBack, setPulledBack] = useState(false);
  const [repInfo, setRepInfo] = useState(null);

  useEffect(() => { getTenantConfig().then(setConfig); }, []);

  useEffect(() => {
    async function load() {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!token || !uuidRe.test(token)) { setError("Invalid signing link."); setLoading(false); return; }

      const { data: prop, error: propErr } = await supabase
        .from("proposals")
        .select("*, call_log_id, call_log(job_name, display_job_number, customer_name, sales_name, jobsite_address, jobsite_city, jobsite_state, jobsite_zip, show_cents, customers(business_address, business_city, business_state, business_zip, contact_email))")
        .eq("signing_token", token)
        .single();

      if (propErr || !prop) { setError("Proposal not found."); setLoading(false); return; }

      // Fetch rep contact info for header
      const salesName = prop.call_log?.sales_name;
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("name, email, phone").eq("name", salesName).maybeSingle();
        if (rep) setRepInfo(rep);
      }

      if (prop.status === "Sold") { setSigned(true); setProposal(prop); setLoading(false); return; }

      // If proposal is Draft (pulled back), block signing
      if (prop.status === "Draft") {
        setPulledBack(true);
        setProposal(prop);
        setLoading(false);
        return;
      }

      const { data: wtcData } = await supabase
        .from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", prop.id)
        .order("created_at", { ascending: true });

      // Load proposal attachments
      const prefix = `proposal-${prop.id}`;
      const { data: attData } = await supabase.storage.from("job-attachments").list(prefix);
      const propAttachments = (attData || []).filter(f => f.name !== ".emptyFolderPlaceholder").map(file => {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(`${prefix}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, url: urlData.publicUrl };
      });

      setProposal({ ...prop, _attachments: propAttachments });
      setWtc(wtcData || []);
      setLoading(false);

      // Track view — update viewed_at for any recipients who haven't viewed yet
      supabase.from("proposal_recipients")
        .update({ viewed_at: new Date().toISOString() })
        .eq("proposal_id", prop.id)
        .is("viewed_at", null)
        .then(() => {});
    }
    load();
  }, [token]);

  async function handleSign() {
    if (name.trim().length <= 2 || signing) return;
    setSigning(true);
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json").catch(() => ({ json: async () => ({ ip: "unknown" }) }));
      const { ip } = await ipRes.json();

      // Generate branded PDF — matches customer-facing header exactly
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 48;
      const contentW = pageW - margin * 2;
      const teal = [48, 207, 172];
      const dark = [28, 24, 20];
      const gray = [106, 99, 88];
      const lightGray = [136, 124, 110];
      let y = 48;

      // --- Logo (left) + Contact info (right) ---
      const logoUrl = config.logo_url || "/hdsp-logo.png";
      try {
        const logoImg = new Image();
        logoImg.crossOrigin = "anonymous";
        await new Promise((resolve, reject) => {
          logoImg.onload = resolve;
          logoImg.onerror = reject;
          logoImg.src = logoUrl;
        });
        const logoH = 40;
        const logoW = (logoImg.naturalWidth / logoImg.naturalHeight) * logoH;
        doc.addImage(logoImg, "PNG", margin, y, logoW, logoH);
      } catch (e) { /* skip logo if it fails to load */ }

      // Contact info — right-aligned
      const rightX = pageW - margin;
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      let ry = y + 8;
      const phone = repInfo?.phone || config.phone || "";
      const email = repInfo?.email || config.email || "";
      if (phone) { doc.text(phone, rightX, ry, { align: "right" }); ry += 13; }
      if (email) { doc.text(email, rightX, ry, { align: "right" }); ry += 13; }
      if (config.website) { doc.text(config.website, rightX, ry, { align: "right" }); ry += 13; }
      if (config.license_number) {
        doc.setTextColor(...lightGray);
        doc.text(config.license_number, rightX, ry, { align: "right" });
      }
      y += 50;

      // Company name + tagline
      doc.setFontSize(16); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text((config.company_name || "Company Name").toUpperCase(), margin, y); y += 16;
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text(config.tagline || "", margin, y); y += 14;

      // Teal header underline
      doc.setDrawColor(...teal);
      doc.setLineWidth(4);
      doc.line(margin, y, pageW - margin, y); y += 24;

      // --- Prepared For (left) + Proposal # / Date (right) ---
      const leftColX = margin;
      const rightColX = pageW / 2 + 20;
      const sectionTop = y;

      // Left: Prepared For
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text("PREPARED FOR", leftColX, y); y += 14;
      doc.setFontSize(12); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text(proposal.call_log?.customer_name || proposal.customer || "", leftColX, y); y += 14;

      // Business address
      const cust = proposal.call_log?.customers;
      if (cust?.business_address) {
        doc.setFontSize(9);
        doc.setTextColor(...lightGray);
        const addrParts = [cust.business_address, cust.business_city, cust.business_state].filter(Boolean);
        let addrLine = addrParts.join(", ");
        if (cust.business_zip) addrLine += " " + cust.business_zip;
        doc.text(addrLine, leftColX, y); y += 13;
      }

      // Jobsite address
      const cl = proposal.call_log;
      if (cl?.jobsite_address) {
        y += 6;
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.setTextColor(...dark);
        doc.text("JOBSITE ADDRESS", leftColX, y); y += 12;
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.setTextColor(...lightGray);
        const jsParts = [cl.jobsite_address, cl.jobsite_city, cl.jobsite_state].filter(Boolean);
        let jsLine = jsParts.join(", ");
        if (cl.jobsite_zip) jsLine += " " + cl.jobsite_zip;
        doc.text(jsLine, leftColX, y); y += 13;
      }

      // Right: Proposal # and Date
      let ry2 = sectionTop;
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text("PROPOSAL #", rightColX, ry2); ry2 += 14;
      doc.setFontSize(11); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      const djn = proposal.call_log?.display_job_number || "—";
      const djnBase = djn.split(" - ")[0];
      const djnRest = djn.indexOf(" - ") > -1 ? " - " + djn.slice(djn.indexOf(" - ") + 3) : "";
      doc.setFont("helvetica", "bold"); doc.setTextColor(...dark);
      doc.text(djnBase, rightColX, ry2);
      const baseW = doc.getTextWidth(djnBase);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...gray);
      doc.text(djnRest + "-P" + (proposal.proposal_number || 1), rightColX + baseW, ry2);
      ry2 += 18;

      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text("DATE", rightColX, ry2); ry2 += 14;
      doc.setFontSize(11); doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), rightColX, ry2);

      y = Math.max(y, ry2) + 16;

      // Divider
      doc.setDrawColor(220, 215, 210);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y); y += 20;

      // --- Introduction ---
      const introText = (proposal.intro || "").trim();
      if (introText) {
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.setTextColor(...lightGray);
        doc.text("INTRODUCTION", margin, y); y += 14;
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.setTextColor(...dark);
        const introLines = doc.splitTextToSize(introText, contentW);
        introLines.forEach(line => {
          if (y > 700) { doc.addPage(); y = 48; }
          doc.text(line, margin, y); y += 14;
        });
        y += 12;
        doc.setDrawColor(220, 215, 210);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageW - margin, y); y += 20;
      }

      // --- Scope of Work ---
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...lightGray);
      doc.text("SCOPE OF WORK", margin, y); y += 14;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.setTextColor(...dark);
      const combinedSow = (wtc || []).map((w, i) => {
        const sow = (w.sales_sow || "").trim();
        if (!sow) return "";
        const header = wtc.length > 1 ? `── Work Type ${i + 1}${w.work_types?.name ? ` — ${w.work_types.name}` : ""} ──\n` : "";
        return header + sow;
      }).filter(Boolean).join("\n\n");
      const sowText = combinedSow || "No scope of work provided.";
      const sowLines = doc.splitTextToSize(sowText, contentW);
      sowLines.forEach(line => {
        if (y > 700) { doc.addPage(); y = 48; }
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
      const totalStr = fmt(total);
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
        signed_at: new Date().toISOString(),
      });

      // Update status + notify rep via edge function (uses service role key to bypass RLS)
      const salesName = proposal.call_log?.sales_name || "";
      let repEmail = "";
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("email").eq("name", salesName).maybeSingle();
        repEmail = rep?.email || "";
      }
      console.log("Calling proposal-signed edge function", { proposalId: proposal.id, callLogId: proposal.call_log_id, repEmail, salesName });
      const { data: fnData, error: fnError } = await supabase.functions.invoke("proposal-signed", {
        body: {
          repEmail,
          repName: salesName,
          customerName: proposal.call_log?.customer_name || "Customer",
          signerName: name.trim(),
          proposalNumber: proposal.proposal_number || proposal.id,
          jobName: proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
          proposalId: proposal.id,
          callLogId: proposal.call_log_id,
          signing_token: token,
        },
      });
      console.log("proposal-signed result:", fnData, fnError);
      if (fnError) {
        console.error("proposal-signed edge function failed, attempting direct update:", fnError);
        await supabase.from("proposals").update({ status: "Sold", approved_at: new Date().toISOString() }).eq("id", proposal.id);
        if (proposal.call_log_id) await supabase.from("call_log").update({ stage: "Sold" }).eq("id", proposal.call_log_id);
      }
      // QB job sync (non-blocking, skip test jobs)
      const isTest = (proposal.customer || "").toLowerCase().includes("test");
      if (proposal.call_log_id && !isTest) {
        supabase.functions.invoke("qb-create-job", { body: { callLogId: proposal.call_log_id, proposalId: proposal.id } }).catch(() => {});
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

  if (pulledBack) return (
    <div style={{ minHeight: "100vh", background: "#F0F4FF", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 20px", textAlign: "center" }}>
        <div style={{ background: "white", borderRadius: 14, border: `2px solid ${T.gray200}`, padding: "40px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#9888;&#65039;</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.gray900, marginBottom: 8 }}>Proposal Withdrawn</div>
          <div style={{ fontSize: 14, color: T.gray500, marginBottom: 24, lineHeight: 1.7 }}>
            This proposal has been pulled back and is no longer available for signing. Please contact your estimator for an updated proposal.
          </div>
          {repInfo && (
            <div style={{ background: "#F0F4FF", borderRadius: 10, padding: "18px 24px", textAlign: "left" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Your Estimator</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.gray900, marginBottom: 4 }}>{repInfo.name}</div>
              {repInfo.phone && <div style={{ fontSize: 13, color: T.gray500, marginBottom: 2 }}><a href={"tel:" + repInfo.phone} style={{ color: T.green, textDecoration: "none", fontWeight: 600 }}>{repInfo.phone}</a></div>}
              {repInfo.email && <div style={{ fontSize: 13, color: T.gray500 }}><a href={"mailto:" + repInfo.email} style={{ color: T.green, textDecoration: "none", fontWeight: 600 }}>{repInfo.email}</a></div>}
            </div>
          )}
        </div>
        <div style={{ marginTop: 24, fontSize: 11, color: T.gray400 }}>{config.company_name} · {config.website}</div>
      </div>
    </div>
  );

  const jobName = proposal.call_log?.job_name || proposal.call_log?.display_job_number || "Proposal";
  const customerName = proposal.call_log?.customer_name || "";
  const cents = proposal.call_log?.show_cents;
  const fmt = n => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

  const total = (wtc || []).reduce((sum, w) => sum + calcWtcPrice(w), 0);

  const wtcs = wtc || [];

  return (
    <div style={{ minHeight: "100vh", background: "#F0F4FF", fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      <style>{`
        @media print {
          [data-no-print] { display: none !important; }
          body, html { background: white !important; }
          div { box-shadow: none !important; }
        }
      `}</style>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>

        {/* Header — matches PDF format */}
        <div style={{ background: "white", padding: "28px 32px 20px", borderRadius: "0 0 14px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 16, borderBottom: `4px solid ${T.green}`, marginBottom: 20 }}>
            <div>
              <img src={config.logo_url || "/hdsp-logo.png"} alt={config.company_name} style={{ height: 50, marginBottom: 6 }} />
              <div style={{ fontSize: 18, fontWeight: 800, color: T.gray900, letterSpacing: "0.02em", textTransform: "uppercase" }}>{config.company_name}</div>
              <div style={{ fontSize: 11, color: T.gray500, marginTop: 3 }}>{config.tagline}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: T.gray500, lineHeight: 1.7 }}>
              <div>{repInfo?.phone || config.phone}</div>
              <div>{repInfo?.email || config.email}</div>
              {config.website && <div>{config.website}</div>}
              {config.license_number && <div style={{ color: T.gray400 }}>{config.license_number}</div>}
            </div>
          </div>

          {/* Prepared For + Proposal # */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 16, borderBottom: `1px solid ${T.gray200}` }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.gray900, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Prepared For</div>
              <div style={{ fontSize: 13, color: T.gray500 }}>{customerName}</div>
              {proposal.call_log?.customers?.business_address && (
                <div style={{ fontSize: 11, color: T.gray400, marginTop: 2, lineHeight: 1.7 }}>
                  {proposal.call_log.customers.business_address}
                  {proposal.call_log.customers.business_city ? ", " + proposal.call_log.customers.business_city : ""}
                  {proposal.call_log.customers.business_state ? ", " + proposal.call_log.customers.business_state : ""}
                  {proposal.call_log.customers.business_zip ? " " + proposal.call_log.customers.business_zip : ""}
                </div>
              )}
              {proposal.call_log?.jobsite_address && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: T.gray900, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Jobsite Address</div>
                  <div style={{ fontSize: 11, color: T.gray400, lineHeight: 1.7 }}>
                    {proposal.call_log.jobsite_address}
                    {proposal.call_log.jobsite_city ? ", " + proposal.call_log.jobsite_city : ""}
                    {proposal.call_log.jobsite_state ? ", " + proposal.call_log.jobsite_state : ""}
                    {proposal.call_log.jobsite_zip ? " " + proposal.call_log.jobsite_zip : ""}
                  </div>
                </div>
              )}
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.gray900, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Proposal #</div>
              <div style={{ fontSize: 12, color: T.gray500 }}><span style={{ fontWeight: 800, color: T.gray900 }}>{(proposal.call_log?.display_job_number || "—").split(" - ")[0]}</span>{(() => { const djn = proposal.call_log?.display_job_number || ""; const idx = djn.indexOf(" - "); return idx > -1 ? " - " + djn.slice(idx + 3) : ""; })()}-P{proposal.proposal_number || 1}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.gray900, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Date</div>
              <div style={{ fontSize: 12, color: T.gray500 }}>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>
        </div>

        {/* Action bar — sign CTA + print/save */}
        {!signed && (
          <div data-no-print style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, marginTop: 4 }}>
            <button onClick={() => document.getElementById("signing-section")?.scrollIntoView({ behavior: "smooth" })} style={{ background: T.green, border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>
              Scroll down to sign electronically
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()} style={{ background: "white", border: `1px solid ${T.gray200}`, borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: T.gray700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                Print
              </button>
              <button onClick={() => window.print()} style={{ background: "white", border: `1px solid ${T.gray200}`, borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: T.gray700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                Save as PDF
              </button>
            </div>
          </div>
        )}

        {/* Introduction */}
        {(proposal.intro || "").trim() && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, marginTop: 8 }}>Introduction</div>
            <div style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "28px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
              <pre style={{ margin: 0, fontSize: 14, color: T.gray700, lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "'Inter', Arial, sans-serif" }}>{proposal.intro.trim()}</pre>
            </div>
          </div>
        )}

        {/* Scope of Work heading */}
        <div style={{ fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, marginTop: 8 }}>Scope of Work</div>

        {/* SOW — one section per WTC */}
        {wtcs.filter(w => (w.sales_sow || "").trim()).map((w, i) => (
          <div key={w.id} style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "28px 32px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            {/* Work Type header with teal lines */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 3, background: T.green, borderRadius: 2 }} />
              <div style={{ fontSize: 12, fontWeight: 800, color: T.gray900, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                Work Type {i + 1}{w.work_types?.name ? ` — ${w.work_types.name}` : ""}
              </div>
              <div style={{ flex: 1, height: 3, background: T.green, borderRadius: 2 }} />
            </div>
            <pre style={{ margin: 0, fontSize: 13, color: T.gray700, lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{w.sales_sow}</pre>
            {wtcs.length > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.gray200}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.gray500 }}>Work Type {i + 1}{w.work_types?.name ? ` — ${w.work_types.name}` : ""} Total</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.green }}>{fmt(calcWtcPrice(w))}</div>
              </div>
            )}
          </div>
        ))}
        {wtcs.filter(w => (w.sales_sow || "").trim()).length === 0 && (
          <div style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "28px 32px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 13, color: T.gray400, fontStyle: "italic" }}>No scope of work provided.</div>
          </div>
        )}

        {/* Total */}
        <div style={{ background: "white", borderRadius: 14, border: `2px solid ${T.green}`, padding: "20px 28px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.gray500, letterSpacing: "0.06em", textTransform: "uppercase" }}>Proposal Total</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: T.gray900 }}>{fmt(total)}</div>
          </div>
        </div>

        {/* Proposal Attachments */}
        {(proposal._attachments || []).length > 0 && (
          <div style={{ background: "white", borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "20px 28px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Attachments</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {proposal._attachments.map(att => (
                <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: T.gray900, color: T.green, fontWeight: 700, fontSize: 12, padding: "6px 14px", borderRadius: 6, textDecoration: "none" }}>
                  {att.name}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Signing */}
        {!signed ? (
          <div id="signing-section" data-no-print style={{ background: "white", borderRadius: 14, border: `2px solid ${T.green}`, padding: "28px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
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
          This proposal is valid for {config.proposal_validity_days} days. · {config.company_name} · {config.website}
        </div>
      </div>
    </div>
  );
}
