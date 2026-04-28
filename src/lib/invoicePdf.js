// ── Invoice PDF Generator ──────────────────────────────────────────────────
// Generates a branded invoice PDF via jsPDF and uploads it to Supabase
// storage (bucket `signed-proposals`, path `invoices/...`). Visual layout
// mirrors the InvoicePDFModal HTML preview in src/pages/Invoices.jsx:
// header with company name, bill-to + invoice # row, optional description,
// line items table, totals (with optional discount), amount due banner.
//
// Used by the send-invoice flow so the emailed pay app can be attached
// as a real PDF file (browser "print to PDF" is not reachable from an
// edge function).

import jsPDF from "jspdf";
import { supabase } from "./supabase";
import { calcWtcPrice } from "./calc";
import { fmt$ } from "./utils";

/**
 * Generate a PDF of an invoice and upload it to Supabase storage.
 *
 * @param {object} args
 * @param {object} args.invoice - invoice row (id, amount, discount, description, due_date, job_id, job_name, status, paid_at)
 * @param {array}  args.lines   - invoice_lines joined with proposal_wtc(work_types(name)) and billing_schedule_line(line_code, description, scheduled_value)
 * @param {object} args.tenantConfig - tenant_config row (company_name, tagline, logo_url, phone, email, website, license_number, address, city, state, zip)
 * @param {object} args.callLog - call_log row (display_job_number, job_name, jobsite_address/city/state/zip)
 * @param {object} args.customer - customers row (billing_name, billing_email, contact_email, first_name, last_name, name, business_address/city/state/zip, billing_address/city/state/zip)
 * @returns {Promise<{pdfUrl: string, storagePath: string}>}
 */
export async function generateInvoicePdf({ invoice, lines = [], tenantConfig = {}, callLog = {}, customer = {} }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();   // 612
  const pageH = doc.internal.pageSize.getHeight();  // 792
  const margin = 48;
  const contentW = pageW - margin * 2;

  // Palette — match HTML preview
  const teal      = [48, 207, 172];
  const dark      = [28, 24, 20];
  const gray      = [74, 66, 56];     // #4a4238 — body gray
  const lightGray = [136, 124, 110];  // #887c6e — secondary
  const red       = [229, 57, 53];    // #e53935 — discount

  let y = 48;

  // ── Company header (top-left name, right-aligned contact block) ─────────
  // We skip the logo raster render (remote URL cross-origin is unreliable);
  // company name + tagline stand in for the logo.
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text((tenantConfig.company_name || "Company Name").toUpperCase(), margin, y);
  y += 14;

  if (tenantConfig.tagline) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(tenantConfig.tagline, margin, y);
  }

  // Right-aligned contact info
  const rightX = pageW - margin;
  let ry = 48;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  if (tenantConfig.phone)   { doc.text(String(tenantConfig.phone),   rightX, ry, { align: "right" }); ry += 13; }
  if (tenantConfig.email)   { doc.text(String(tenantConfig.email),   rightX, ry, { align: "right" }); ry += 13; }
  if (tenantConfig.website) { doc.text(String(tenantConfig.website), rightX, ry, { align: "right" }); ry += 13; }
  if (tenantConfig.license_number) {
    doc.setTextColor(...lightGray);
    doc.text(String(tenantConfig.license_number), rightX, ry, { align: "right" });
    ry += 13;
  }

  y = Math.max(y + 10, ry + 4);

  // Teal underline under header
  doc.setDrawColor(...teal);
  doc.setLineWidth(4);
  doc.line(margin, y, pageW - margin, y);
  y += 24;

  // ── Bill To (left) + Invoice # / Job # / Due Date (right) ───────────────
  const leftColX = margin;
  const rightColX = pageW / 2 + 20;
  const sectionTop = y;

  // Left: Bill To
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text("BILL TO", leftColX, y);
  y += 14;

  const billingName =
    customer.billing_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    customer.name ||
    invoice.job_name ||
    "—";
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  doc.text(String(billingName), leftColX, y);
  y += 13;

  const billingEmail = customer.billing_email || customer.contact_email || customer.email || "";
  if (billingEmail) {
    doc.setFontSize(9);
    doc.setTextColor(...lightGray);
    doc.text(String(billingEmail), leftColX, y);
    y += 12;
  }

  // Billing address (fallback to business address)
  const billAddr  = customer.billing_address  || customer.business_address  || "";
  const billCity  = customer.billing_city     || customer.business_city     || "";
  const billState = customer.billing_state    || customer.business_state    || "";
  const billZip   = customer.billing_zip      || customer.business_zip      || "";
  if (billAddr) {
    doc.setFontSize(9);
    doc.setTextColor(...lightGray);
    doc.text(String(billAddr), leftColX, y);
    y += 12;
    const cityStateZip = [[billCity, billState].filter(Boolean).join(", "), billZip].filter(Boolean).join(" ");
    if (cityStateZip) {
      doc.text(cityStateZip, leftColX, y);
      y += 12;
    }
  }

  // Jobsite address
  if (callLog?.jobsite_address) {
    y += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text("JOBSITE ADDRESS", leftColX, y);
    y += 12;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...lightGray);
    doc.text(String(callLog.jobsite_address), leftColX, y);
    y += 12;
    const jsCity = [[callLog.jobsite_city, callLog.jobsite_state].filter(Boolean).join(", "), callLog.jobsite_zip].filter(Boolean).join(" ");
    if (jsCity) {
      doc.text(jsCity, leftColX, y);
      y += 12;
    }
  }

  // Right: Invoice # / Job # / Due Date
  let ry2 = sectionTop;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text("INVOICE #", rightColX, ry2);
  ry2 += 14;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  doc.text(String(invoice.id || "—"), rightColX, ry2);
  ry2 += 18;

  // Prefer customer's internal job # (e.g. DA Builders' 6359) over Sales Command's job_id.
  const displayJobNo = callLog?.subcontractor_job_no || callLog?.job_number || invoice.job_id;
  if (displayJobNo) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text("JOB #", rightColX, ry2);
    ry2 += 14;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(String(displayJobNo), rightColX, ry2);
    ry2 += 18;
  }

  if (invoice.due_date) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text("DUE DATE", rightColX, ry2);
    ry2 += 14;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(fmtDate(invoice.due_date), rightColX, ry2);
    ry2 += 18;
  }

  y = Math.max(y, ry2) + 12;

  // Divider
  doc.setDrawColor(220, 215, 210);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 18;

  // ── Line Items table ───────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...lightGray);
  doc.text("LINE ITEMS", margin, y);
  y += 14;

  // Column layout (letter = 612pt wide; content = 516pt)
  //   Description  |  Amount   |  Billing %  |  Line Total
  //   left-align   |  right    |  right      |  right (bold)
  const colDescX = margin;
  const colAmtX  = margin + contentW * 0.52;  // right edge of amount col
  const colPctX  = margin + contentW * 0.72;  // right edge of pct col
  const colTotX  = margin + contentW;         // right edge of total col

  // Header row
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...lightGray);
  doc.text("DESCRIPTION",  colDescX, y);
  doc.text("AMOUNT",       colAmtX,  y, { align: "right" });
  doc.text("BILLING %",    colPctX,  y, { align: "right" });
  doc.text("LINE TOTAL",   colTotX,  y, { align: "right" });
  y += 6;
  doc.setDrawColor(...dark);
  doc.setLineWidth(1.25);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  // Body rows
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);

  for (const l of lines) {
    const wtc = l.proposal_wtc;
    const sov = l.billing_schedule_line;
    const isSov = !wtc && sov;
    const lineLabel = isSov
      ? (sov.line_code ? `${sov.line_code} — ${sov.description || ""}` : (sov.description || "—"))
      : (wtc?.work_types?.name || l.description || "—");
    const rowAmount = isSov
      ? (parseFloat(sov.scheduled_value) || 0)
      : (wtc ? calcWtcPrice(wtc) : 0);
    const billingPct = l.billing_pct ?? 0;
    const lineTotal  = l.amount ?? 0;

    // Wrap long description labels against the width available before the amount col.
    // Amount is right-aligned at colAmtX, so its text can extend ~90pts to the left.
    // Reserve that width + padding so description never overlaps the $ amount.
    const descMaxW = (colAmtX - colDescX) - 90;
    const wrapped = doc.splitTextToSize(String(lineLabel), descMaxW);
    const rowH = Math.max(wrapped.length * 13, 14) + 6;

    y = ensureSpace(doc, y, rowH + 6, pageH);

    // Label
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    wrapped.forEach((line, i) => {
      doc.text(line, colDescX, y + i * 13);
    });

    // Amount
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(fmt$(rowAmount), colAmtX, y, { align: "right" });

    // Billing %
    doc.text(`${billingPct}%`, colPctX, y, { align: "right" });

    // Line total (bold)
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text(fmt$(lineTotal), colTotX, y, { align: "right" });

    y += rowH;

    // Row separator
    doc.setDrawColor(220, 215, 210);
    doc.setLineWidth(0.5);
    doc.line(margin, y - 4, pageW - margin, y - 4);
  }

  y += 14;

  // ── Totals ─────────────────────────────────────────────────────────────
  const hasDiscount = (invoice.discount || 0) > 0;
  const subtotal = invoice.amount || 0;
  const discount = invoice.discount || 0;
  const netTotal = subtotal - discount;

  if (hasDiscount) {
    y = ensureSpace(doc, y, 32, pageH);

    // Subtotal
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...lightGray);
    doc.text("Subtotal", colPctX, y, { align: "right" });
    doc.setTextColor(...dark);
    doc.text(fmt$(subtotal), colTotX, y, { align: "right" });
    y += 16;

    // Discount
    doc.setTextColor(...red);
    doc.text("Discount", colPctX, y, { align: "right" });
    doc.text(`-${fmt$(discount)}`, colTotX, y, { align: "right" });
    y += 18;
  }

  // ── Work Description (above Amount Due) ────────────────────────────────
  if (invoice.description && String(invoice.description).trim()) {
    const descLines = doc.splitTextToSize(String(invoice.description).trim(), contentW - 24);
    const blockH = 18 + descLines.length * 13 + 12;
    y = ensureSpace(doc, y, blockH + 8, pageH);
    doc.setFillColor(248, 246, 243);
    doc.setDrawColor(220, 215, 210);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, contentW, blockH, 4, 4, "FD");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...lightGray);
    doc.text("WORK DESCRIPTION", margin + 12, y + 14);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    let dy = y + 28;
    descLines.forEach(line => { doc.text(line, margin + 12, dy); dy += 13; });
    y += blockH + 8;
  }

  // Amount Due banner — teal outlined box
  y = ensureSpace(doc, y, 56, pageH);
  doc.setDrawColor(...teal);
  doc.setLineWidth(2);
  doc.roundedRect(margin, y, contentW, 44, 6, 6, "S");

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gray);
  doc.text("AMOUNT DUE", margin + 16, y + 27);

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text(fmt$(netTotal), pageW - margin - 16, y + 29, { align: "right" });
  y += 64;

  // ── Payment status / footer ───────────────────────────────────────────
  y = ensureSpace(doc, y, 40, pageH);
  doc.setDrawColor(220, 215, 210);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 16;

  if (invoice.status === "Paid" && invoice.paid_at) {
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...teal);
    doc.text("PAID", pageW / 2, y + 10, { align: "center" });
    y += 22;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(fmtDate(invoice.paid_at), pageW / 2, y, { align: "center" });
    y += 18;
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...lightGray);
    const dueText = `Payment due upon receipt${invoice.due_date ? ` · Due by ${fmtDate(invoice.due_date)}` : ""}`;
    doc.text(dueText, pageW / 2, y, { align: "center" });
    y += 14;
  }

  // Contact line
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...lightGray);
  const contactEmail = tenantConfig.email || "";
  const contactPhone = tenantConfig.phone || "";
  const contactBits = [];
  if (contactEmail) contactBits.push(`Contact ${contactEmail}`);
  if (contactPhone) contactBits.push(`call ${contactPhone}`);
  if (contactBits.length) {
    doc.text(`Questions? ${contactBits.join(" or ")}`, pageW / 2, y, { align: "center" });
  }

  // ── Save + Upload ─────────────────────────────────────────────────────
  const arrayBuffer = doc.output("arraybuffer");
  const pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });

  const storagePath = `invoices/${invoice.id}-${Date.now()}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from("signed-proposals")
    .upload(storagePath, pdfBlob, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    throw new Error(`Invoice PDF upload failed: ${uploadErr.message}`);
  }

  const { data: urlData } = supabase.storage.from("signed-proposals").getPublicUrl(storagePath);
  const pdfUrl = urlData?.publicUrl || "";

  return { pdfUrl, storagePath };
}

// ── Helpers ────────────────────────────────────────────────────────────
function ensureSpace(doc, y, needed, pageH) {
  if (y + needed > pageH - 48) {
    doc.addPage();
    return 48;
  }
  return y;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(String(d).includes("T") ? d : d + "T00:00:00");
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
