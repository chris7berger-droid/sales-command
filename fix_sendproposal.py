with open("src/pages/Proposals.jsx", "r") as f:
    content = f.read()

old = '''function SendPlaceholder({ proposal, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 420, gap: 16 }}>
      <div style={{ fontSize: 44 }}>📤</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Send Proposal</div>
      <div style={{ fontSize: 13, color: '#888', fontFamily: 'inherit' }}>Proposal {proposal.id} · SC-29 — Coming in Tier 2</div>
      <button onClick={onBack} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#00b4a0', fontWeight: 800, fontSize: 12, fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        ← Back to Proposal
      </button>
    </div>
  );
}'''

new = '''function SendPlaceholder({ proposal, onBack }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const signingUrl = `${window.location.origin}/sign/${proposal.signing_token}`;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        "https://pbgvgjjuhnpsumnowuym.supabase.co/functions/v1/send-proposal",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            customerEmail: proposal.call_log?.customer_email || "",
            customerName:  proposal.call_log?.customer_name  || "Customer",
            repEmail:      proposal.rep_email || "",
            repName:       proposal.rep_name  || "",
            proposalNumber: proposal.proposal_number || proposal.id,
            jobName:       proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
            signingUrl,
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setSent(true);
    } catch (e) {
      setError(e.message || "Send failed. Please try again.");
    }
    setSending(false);
  }

  if (sent) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, gap: 16 }}>
      <div style={{ fontSize: 48 }}>✅</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e", fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}>Proposal Sent</div>
      <div style={{ fontSize: 13, color: "#888", fontFamily: "inherit", textAlign: "center", maxWidth: 360 }}>
        The signing link has been emailed to the customer.
      </div>
      <div style={{ fontSize: 12, color: "#888", background: "#f5f5f5", borderRadius: 8, padding: "10px 16px", maxWidth: 420, wordBreak: "break-all", textAlign: "center" }}>
        {signingUrl}
      </div>
      <button onClick={onBack} style={{ marginTop: 8, background: "none", border: "none", cursor: "pointer", color: "#00b4a0", fontWeight: 800, fontSize: 12, fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        ← Back to Proposal
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, gap: 16 }}>
      <div style={{ fontSize: 48 }}>📤</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e", fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}>Send Proposal</div>
      <div style={{ fontSize: 13, color: "#888", fontFamily: "inherit", textAlign: "center", maxWidth: 360 }}>
        This will email the customer a link to review and sign the proposal electronically.
      </div>
      <div style={{ fontSize: 12, color: "#aaa", background: "#f5f5f5", borderRadius: 8, padding: "10px 16px", maxWidth: 420, wordBreak: "break-all", textAlign: "center" }}>
        {signingUrl}
      </div>
      {error && <div style={{ fontSize: 12, color: "#e53935", maxWidth: 360, textAlign: "center" }}>{error}</div>}
      <button
        onClick={handleSend}
        disabled={sending}
        style={{ background: sending ? "#ccc" : "#30cfac", color: "white", border: "none", borderRadius: 8, padding: "12px 32px", fontSize: 14, fontWeight: 800, cursor: sending ? "default" : "pointer", fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        {sending ? "Sending…" : "📨 Send to Customer"}
      </button>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#00b4a0", fontWeight: 800, fontSize: 12, fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        ← Back to Proposal
      </button>
    </div>
  );
}'''

if old in content:
    content = content.replace(old, new, 1)
    print("OK: SendPlaceholder replaced")
else:
    print("FAIL: SendPlaceholder not found")

with open("src/pages/Proposals.jsx", "w") as f:
    f.write(content)

print("Done.")
