import jsPDF from "jspdf";
import { supabase } from "./supabase";
import { fmt$ } from "./utils";

export async function generateSovPdf({ lines, billingProgress, retainagePct, tenantConfig = {}, customerName, jobName, jobNumber, invoiceId, appNumber }) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const contentW = pageW - margin * 2;

  const teal      = [48, 207, 172];
  const dark      = [28, 24, 20];
  const gray      = [74, 66, 56];
  const lightGray = [136, 124, 110];
  const white     = [255, 255, 255];

  let y = 40;

  // Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text((tenantConfig.company_name || "Company Name").toUpperCase(), margin, y);
  y += 14;

  if (tenantConfig.tagline) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(tenantConfig.tagline, margin, y);
  }

  const rightX = pageW - margin;
  let ry = 40;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  if (tenantConfig.phone)   { doc.text(String(tenantConfig.phone),   rightX, ry, { align: "right" }); ry += 12; }
  if (tenantConfig.email)   { doc.text(String(tenantConfig.email),   rightX, ry, { align: "right" }); ry += 12; }
  if (tenantConfig.website) { doc.text(String(tenantConfig.website), rightX, ry, { align: "right" }); ry += 12; }

  y = Math.max(y + 10, ry + 4);
  doc.setDrawColor(...teal);
  doc.setLineWidth(3);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // Title
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text("SCHEDULE OF VALUES", margin, y);
  y += 18;

  // Meta row
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  const metaParts = [
    customerName && `Customer: ${customerName}`,
    jobName && `Job: ${jobName}`,
    jobNumber && `Job #: ${jobNumber}`,
    invoiceId && `Invoice #: ${invoiceId}`,
    appNumber && `Pay App #: ${appNumber}`,
    `Retainage: ${retainagePct}%`,
  ].filter(Boolean);
  doc.text(metaParts.join("    |    "), margin, y);
  y += 20;

  // Table
  const cols = [
    { label: "#",           w: 30,  align: "left" },
    { label: "Code",        w: 70,  align: "left" },
    { label: "Description", w: 0,   align: "left" },
    { label: "Scheduled Value", w: 90, align: "right" },
    { label: "CO",          w: 40,  align: "center" },
    { label: "Billed",      w: 80,  align: "right" },
    { label: "% Done",      w: 55,  align: "right" },
    { label: "Balance",     w: 80,  align: "right" },
    { label: "Retainage",   w: 70,  align: "right" },
  ];

  const fixedW = cols.reduce((s, c) => s + c.w, 0);
  cols[2].w = contentW - fixedW;

  const rowH = 18;
  const headerH = 22;

  // Header row
  doc.setFillColor(...dark);
  doc.rect(margin, y, contentW, headerH, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...white);

  let cx = margin;
  for (const col of cols) {
    const tx = col.align === "right" ? cx + col.w - 4 : col.align === "center" ? cx + col.w / 2 : cx + 4;
    doc.text(col.label.toUpperCase(), tx, y + 14, { align: col.align === "center" ? "center" : col.align === "right" ? "right" : "left" });
    cx += col.w;
  }
  y += headerH;

  // Data rows
  let totalScheduled = 0, totalBilled = 0, totalBalance = 0, totalRetainage = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    const sv = parseFloat(l.scheduled_value) || 0;
    const billed = billingProgress[l.id] || 0;
    const pctDone = sv > 0 ? (billed / sv) * 100 : 0;
    const balance = sv - billed;
    const ret = billed * (retainagePct / 100);

    totalScheduled += sv;
    totalBilled += billed;
    totalBalance += balance;
    totalRetainage += ret;

    if (idx % 2 === 0) {
      doc.setFillColor(245, 241, 235);
      doc.rect(margin, y, contentW, rowH, "F");
    }

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);

    const vals = [
      String(idx + 1),
      l.line_code || "—",
      l.description || "",
      fmt$(sv),
      l.is_change_order ? `CO${l.co_number || ""}` : "",
      fmt$(billed),
      `${pctDone.toFixed(1)}%`,
      fmt$(balance),
      fmt$(ret),
    ];

    cx = margin;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      const tx = col.align === "right" ? cx + col.w - 4 : col.align === "center" ? cx + col.w / 2 : cx + 4;
      if (ci === 3 || ci === 5 || ci === 7 || ci === 8) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...dark);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...gray);
      }
      let text = vals[ci];
      if (ci === 2) {
        const maxW = col.w - 8;
        text = doc.splitTextToSize(text, maxW)[0] || "";
      }
      doc.text(text, tx, y + 12, { align: col.align === "center" ? "center" : col.align === "right" ? "right" : "left" });
      cx += col.w;
    }
    y += rowH;

    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = 40;
    }
  }

  // Totals row
  doc.setFillColor(...dark);
  doc.rect(margin, y, contentW, headerH, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...teal);

  cx = margin;
  const totals = ["", "", "TOTALS", fmt$(totalScheduled), "", fmt$(totalBilled), "", fmt$(totalBalance), fmt$(totalRetainage)];
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    const tx = col.align === "right" ? cx + col.w - 4 : col.align === "center" ? cx + col.w / 2 : cx + 4;
    if (totals[ci]) {
      doc.text(totals[ci], tx, y + 14, { align: col.align === "center" ? "center" : col.align === "right" ? "right" : "left" });
    }
    cx += col.w;
  }

  // Upload
  const pdfBlob = doc.output("blob");
  const fileName = `sov-${invoiceId || "draft"}-${Date.now()}.pdf`;
  const storagePath = `pay-app-sov/${fileName}`;
  const { error: upErr } = await supabase.storage.from("job-attachments").upload(storagePath, pdfBlob, { contentType: "application/pdf" });
  if (upErr) throw new Error(upErr.message);
  const { data: pub } = supabase.storage.from("job-attachments").getPublicUrl(storagePath);
  return { pdfUrl: pub?.publicUrl, storagePath };
}
