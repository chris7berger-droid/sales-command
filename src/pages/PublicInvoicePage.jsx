import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { createPublicClient } from "../lib/supabasePublic";
import { useMemo } from "react";
import { calcWtcPrice } from "../lib/calc";
import { getTenantConfig, DEFAULTS } from "../lib/config";
import { fmt$, fmt$c, fmtD } from "../lib/utils";

export default function PublicInvoicePage() {
  const { token } = useParams();
  const supabase = useMemo(() => createPublicClient({ viewingToken: token }), [token]);
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(DEFAULTS);
  const [repContact, setRepContact] = useState({ phone: "", email: "" });

  useEffect(() => { getTenantConfig().then(setConfig); }, []);

  useEffect(() => {
    async function load() {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!token || !uuidRe.test(token)) { setError("Invalid invoice link."); setLoading(false); return; }

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select("*, proposals(call_log(customer_name, sales_name, display_job_number, jobsite_address, jobsite_city, jobsite_state, jobsite_zip, show_cents, customers(billing_name, billing_email, contact_email, first_name, last_name, name, business_address, business_city, business_state, business_zip)))")
        .eq("viewing_token", token)
        .single();

      if (invErr || !inv) { setError("Invoice not found."); setLoading(false); return; }
      setInvoice(inv);

      // Load lines
      const { data: lineData } = await supabase
        .from("invoice_lines")
        .select("*, proposal_wtc(*, work_types(name))")
        .eq("invoice_id", inv.id);
      setLines(lineData || []);

      // Load rep contact
      const salesName = inv.proposals?.call_log?.sales_name;
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("phone, email").eq("name", salesName).maybeSingle();
        if (rep) setRepContact({ phone: rep.phone || "", email: rep.email || "" });
      }

      setLoading(false);
    }
    load();
  }, [token]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f0eb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
        <div style={{ fontSize: 14, color: "#887c6e" }}>Loading invoice...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f0eb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
        <div style={{ background: "white", borderRadius: 16, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: "0 12px 48px rgba(0,0,0,0.12)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1814", marginBottom: 8 }}>Oops</div>
          <div style={{ fontSize: 14, color: "#4a4238" }}>{error}</div>
        </div>
      </div>
    );
  }

  const effectiveShowCents = invoice.show_cents ?? invoice.proposals?.call_log?.show_cents;
  const money = effectiveShowCents ? fmt$c : fmt$;
  const retentionAmt = parseFloat(invoice.retention_amount) || 0;
  const retentionPct = parseFloat(invoice.retention_pct) || 0;
  const netTotal = (invoice.amount || 0) - (invoice.discount || 0) - retentionAmt;
  const cl = invoice.proposals?.call_log;
  const cust = cl?.customers;
  const billingName = cust?.billing_name || [cust?.first_name, cust?.last_name].filter(Boolean).join(" ") || cust?.name || "";
  const billingEmail = cust?.billing_email || cust?.contact_email || "";
  const jobsiteParts = [cl?.jobsite_address, cl?.jobsite_city, cl?.jobsite_state, cl?.jobsite_zip].filter(Boolean);
  const jobsiteAddress = jobsiteParts.length > 1
    ? `${cl?.jobsite_address || ""}\n${[cl?.jobsite_city, cl?.jobsite_state].filter(Boolean).join(", ")}${cl?.jobsite_zip ? " " + cl.jobsite_zip : ""}`
    : jobsiteParts.join("");
  const isPaid = invoice.status === "Paid";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0eb", fontFamily: "Arial, sans-serif" }}>
      <style>{`
        @media print {
          body { background: white !important; }
          [data-inv-actions] { display: none !important; }
          [data-inv-page] { padding: 0 !important; }
          [data-inv-card] { box-shadow: none !important; border: none !important; border-radius: 0 !important; max-width: 100% !important; }
          @page { margin: 0.6in; size: letter; }
        }
      `}</style>

      {/* Action bar */}
      <div data-inv-actions style={{ background: "white", borderBottom: "1px solid #e5e0d8", padding: "12px 24px", display: "flex", justifyContent: "center", gap: 12 }}>
        <button onClick={() => window.print()} style={{ background: "none", border: "1.5px solid #d1cdc7", borderRadius: 7, padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#4a4238", cursor: "pointer", fontFamily: "inherit" }}>
          Print / Save PDF
        </button>
        {!isPaid && invoice.stripe_checkout_url && (
          <a href={invoice.stripe_checkout_url} style={{ background: "#30cfac", color: "#1c1814", border: "none", borderRadius: 7, padding: "8px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", display: "inline-block" }}>
            Pay Now
          </a>
        )}
      </div>

      <div data-inv-page style={{ padding: "32px 20px", display: "flex", justifyContent: "center" }}>
        <div data-inv-card style={{ background: "white", borderRadius: 16, padding: "40px 44px", maxWidth: 800, width: "100%", boxShadow: "0 12px 48px rgba(0,0,0,0.08)", color: "#1c1814" }}>

          {/* Company header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 16, borderBottom: "4px solid #30cfac", marginBottom: 24 }}>
            <div>
              <img src={config.logo_url || "/hdsp-logo.png"} alt={config.company_name} style={{ height: 60, marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>{config.company_name}</div>
              <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>{config.tagline}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: "#4a4238", lineHeight: 1.7 }}>
              <div>{repContact.phone || config.phone}</div>
              <div>{repContact.email || config.email}</div>
              <div>{config.website}</div>
              <div style={{ color: "#887c6e" }}>{config.license_number}</div>
            </div>
          </div>

          {/* Invoice info */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Bill To</div>
              <div style={{ fontSize: 12, color: "#887c6e" }}>{billingName || invoice.job_name || "—"}</div>
              {billingEmail && <div style={{ fontSize: 11, color: "#887c6e", marginTop: 2 }}>{billingEmail}</div>}
              {jobsiteAddress && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Jobsite Address</div>
                  <div style={{ fontSize: 11, color: "#887c6e", lineHeight: 1.7, whiteSpace: "pre-line" }}>{jobsiteAddress}</div>
                </div>
              )}
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Invoice #</div>
              <div style={{ fontSize: 12, color: "#887c6e" }}>{invoice.id}</div>
              {invoice.job_id && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Job #</div>
                  <div style={{ fontSize: 12, color: "#887c6e" }}>{invoice.job_id}</div>
                </>
              )}
              {invoice.due_date && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Due Date</div>
                  <div style={{ fontSize: 12, color: "#887c6e" }}>{fmtD(invoice.due_date)}</div>
                </>
              )}
            </div>
          </div>

          {/* Description */}
          {invoice.description && (
            <div style={{ fontSize: 13, color: "#4a4238", lineHeight: 1.6, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)", whiteSpace: "pre-wrap" }}>
              {invoice.description}
            </div>
          )}

          {/* Line items */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Line Items</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1c1814" }}>
                  {["Description", "Amount", "Billing %", "Line Total"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Description" ? "left" : "right", fontWeight: 700, fontSize: 10.5, color: "#887c6e", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const wtc = l.proposal_wtc;
                  const wtcTotal = wtc ? calcWtcPrice(wtc) : 0;
                  return (
                    <tr key={l.id} style={{ borderBottom: "1px solid rgba(28,24,20,0.1)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{wtc?.work_types?.name || "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(wtcTotal)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>{l.billing_pct}%</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          {(invoice.discount > 0 || retentionAmt > 0) && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                <span style={{ color: "#887c6e", fontWeight: 600 }}>Subtotal</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(invoice.amount)}</span>
              </div>
            </div>
          )}
          {invoice.discount > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                <span style={{ color: "#e53935", fontWeight: 600 }}>Discount</span>
                <span style={{ fontWeight: 700, color: "#e53935", fontVariantNumeric: "tabular-nums" }}>-{money(invoice.discount)}</span>
              </div>
            </div>
          )}
          {retentionAmt > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                <span style={{ color: "#887c6e", fontWeight: 600 }}>Less Retention{retentionPct > 0 ? ` (${retentionPct}%)` : ""}</span>
                <span style={{ fontWeight: 700, color: "#887c6e", fontVariantNumeric: "tabular-nums" }}>-{money(retentionAmt)}</span>
              </div>
            </div>
          )}
          <div style={{ border: "2px solid #30cfac", borderRadius: 8, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Amount Due</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" }}>{money(netTotal)}</div>
          </div>

          {/* Status / Footer */}
          {isPaid && invoice.paid_at ? (
            <div style={{ borderTop: "1.5px solid rgba(48,207,172,0.4)", paddingTop: 20, textAlign: "center" }}>
              <div style={{ display: "inline-block", border: "3px solid #30cfac", borderRadius: 10, padding: "12px 32px", transform: "rotate(-3deg)" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#30cfac", letterSpacing: "0.1em", textTransform: "uppercase" }}>PAID</div>
                <div style={{ fontSize: 12, color: "#4a4238", fontWeight: 600, marginTop: 4 }}>{fmtD(invoice.paid_at)}</div>
              </div>
              <div style={{ fontSize: 11, color: "#887c6e", marginTop: 16 }}>
                Questions? Contact {repContact.email || config.email} or call {repContact.phone || config.phone}
              </div>
            </div>
          ) : (
            <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20, textAlign: "center" }}>
              {invoice.stripe_checkout_url && (
                <a href={invoice.stripe_checkout_url} style={{ display: "inline-block", background: "#30cfac", color: "#1c1814", padding: "14px 40px", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                  Pay Now
                </a>
              )}
              <div style={{ fontSize: 11, color: "#887c6e", fontStyle: "italic" }}>
                Payment due upon receipt{invoice.due_date ? ` · Due by ${fmtD(invoice.due_date)}` : ""}
              </div>
              <div style={{ fontSize: 11, color: "#887c6e", marginTop: 4 }}>
                Questions? Contact {repContact.email || config.email} or call {repContact.phone || config.phone}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
