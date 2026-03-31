import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getTenantConfig, DEFAULTS } from "../lib/config";

export default function InvoicePaidPage() {
  const [params] = useSearchParams();
  const invoiceId = params.get("invoice_id") || "";
  const [status, setStatus] = useState("loading");
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email }));
  }, []);

  useEffect(() => {
    // Brief delay so Stripe webhook has time to process
    const t = setTimeout(() => setStatus("done"), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0eb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "white", borderRadius: 16, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: "0 12px 48px rgba(0,0,0,0.12)" }}>

        <div style={{ borderBottom: "4px solid #30cfac", paddingBottom: 16, marginBottom: 32 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>{COMPANY.name}</div>
          <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>{COMPANY.tagline}</div>
        </div>

        {status === "loading" ? (
          <div style={{ padding: "40px 0", color: "#887c6e", fontSize: 14 }}>Confirming payment...</div>
        ) : (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(48,207,172,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "2px solid #30cfac" }}>
              <span style={{ fontSize: 28, color: "#30cfac" }}>&#10003;</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1c1814", marginBottom: 8 }}>Payment Received</div>
            <div style={{ fontSize: 14, color: "#4a4238", marginBottom: 6 }}>Thank you for your payment.</div>
            {invoiceId && <div style={{ fontSize: 13, color: "#887c6e", marginBottom: 24 }}>Invoice #{invoiceId}</div>}
            <div style={{ fontSize: 12, color: "#887c6e", borderTop: "1px solid #e5e0d8", paddingTop: 20 }}>
              Questions? Contact {COMPANY.email} or call {COMPANY.phone}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
