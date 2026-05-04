import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";

const POLL_INTERVAL = 5 * 60 * 1000;

function getScriptHash() {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]');
  if (!el) return null;
  const m = el.getAttribute("src").match(/index-([^.]+)\.js/);
  return m ? m[1] : null;
}

export default function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [initialHash] = useState(() => getScriptHash());

  useEffect(() => {
    if (!initialHash) return;
    const check = async () => {
      try {
        const res = await fetch("/?_vc=" + Date.now(), { cache: "no-store" });
        const html = await res.text();
        const m = html.match(/index-([^.]+)\.js/);
        if (m && m[1] !== initialHash) setShow(true);
      } catch {}
    };
    const id = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [initialHash]);

  if (!show) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: C.dark, border: `1.5px solid ${C.teal}`, borderRadius: 10,
      padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
      zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <span style={{ fontSize: 13, color: C.teal, fontFamily: F.ui, fontWeight: 600 }}>
        A new version is available
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: C.teal, color: C.dark, border: "none", borderRadius: 6,
          padding: "6px 16px", fontSize: 12, fontWeight: 800, cursor: "pointer",
          fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
        }}
      >
        Refresh
      </button>
      <button
        onClick={() => setShow(false)}
        style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, fontSize: 16, padding: "0 4px" }}
      >
        ✕
      </button>
    </div>
  );
}
