import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";

export default function QBCallbackPage() {
  const [params] = useSearchParams();
  const code = params.get("code") || "";
  const realmId = params.get("realmId") || "";
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code || !realmId) {
      setStatus("error");
      setError("Missing authorization code or company ID from QuickBooks.");
      return;
    }

    async function exchange() {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("qb-auth", {
          body: { action: "exchange", code, realmId },
        });
        console.log("qb-auth response:", { data, fnErr });
        if (fnErr) {
          const detail = typeof fnErr === "object" ? (fnErr.message || JSON.stringify(fnErr)) : String(fnErr);
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);
        setStatus("connected");
      } catch (e) {
        setStatus("error");
        setError(e.message || "Failed to connect to QuickBooks.");
      }
    }
    exchange();
  }, [code, realmId]);

  return (
    <div style={{ minHeight: "100vh", background: C.linen, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.body }}>
      <div style={{ background: C.linenCard, borderRadius: 16, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: "0 8px 40px rgba(28,24,20,0.13)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ borderBottom: `4px solid ${C.teal}`, paddingBottom: 16, marginBottom: 32 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: F.display }}>Sales <span style={{ color: C.tealDark }}>Command</span></div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3 }}>QuickBooks Integration</div>
        </div>

        {status === "connecting" && (
          <div style={{ padding: "40px 0", color: C.textFaint, fontSize: 14 }}>Connecting to QuickBooks...</div>
        )}

        {status === "connected" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.tealGlow, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: `2px solid ${C.teal}` }}>
              <span style={{ fontSize: 28, color: C.teal }}>&#10003;</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, marginBottom: 8, fontFamily: F.display }}>QuickBooks Connected</div>
            <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 24 }}>Your QuickBooks account is now linked to Sales Command.</div>
            <a href="/" style={{ display: "inline-block", background: C.teal, color: C.dark, padding: "12px 32px", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14 }}>Return to App</a>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(229,57,53,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: `2px solid ${C.red}` }}>
              <span style={{ fontSize: 28, color: C.red }}>!</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, marginBottom: 8, fontFamily: F.display }}>Connection Failed</div>
            <div style={{ fontSize: 14, color: C.red, marginBottom: 24 }}>{error}</div>
            <a href="/" style={{ display: "inline-block", background: C.teal, color: C.dark, padding: "12px 32px", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14 }}>Return to App</a>
          </>
        )}
      </div>
    </div>
  );
}
