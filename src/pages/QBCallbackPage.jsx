import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

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
        if (fnErr) throw new Error(fnErr.message || "Connection failed");
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
    <div style={{ minHeight: "100vh", background: "#f5f0eb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "white", borderRadius: 16, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: "0 12px 48px rgba(0,0,0,0.12)" }}>

        <div style={{ borderBottom: "4px solid #30cfac", paddingBottom: 16, marginBottom: 32 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>High Desert Surface Prep</div>
          <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>Sales Command</div>
        </div>

        {status === "connecting" && (
          <div style={{ padding: "40px 0", color: "#887c6e", fontSize: 14 }}>Connecting to QuickBooks...</div>
        )}

        {status === "connected" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(48,207,172,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "2px solid #30cfac" }}>
              <span style={{ fontSize: 28, color: "#30cfac" }}>&#10003;</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1c1814", marginBottom: 8 }}>QuickBooks Connected</div>
            <div style={{ fontSize: 14, color: "#4a4238", marginBottom: 24 }}>Your QuickBooks account is now linked to Sales Command.</div>
            <a href="/" style={{ display: "inline-block", background: "#30cfac", color: "#1c1814", padding: "12px 32px", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14 }}>Return to App</a>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(220,60,60,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "2px solid #dc3c3c" }}>
              <span style={{ fontSize: 28, color: "#dc3c3c" }}>!</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1c1814", marginBottom: 8 }}>Connection Failed</div>
            <div style={{ fontSize: 14, color: "#dc3c3c", marginBottom: 24 }}>{error}</div>
            <a href="/" style={{ display: "inline-block", background: "#30cfac", color: "#1c1814", padding: "12px 32px", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14 }}>Return to App</a>
          </>
        )}
      </div>
    </div>
  );
}
