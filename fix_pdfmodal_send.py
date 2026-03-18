with open("src/pages/Proposals.jsx", "r") as f:
    content = f.read()

old_state = '  const [sendDone, setSendDone] = useState(false);'
new_state = ('  const [sendDone, setSendDone] = useState(false);\n'
             '  const [sending, setSending] = useState(false);\n'
             '  const [sendError, setSendError] = useState(null);\n'
             '  const signingUrl = `${window.location.origin}/sign/${proposal.signing_token}`;\n'
             '\n'
             '  async function handleSend() {\n'
             '    setSending(true);\n'
             '    setSendError(null);\n'
             '    try {\n'
             '      const { data: { session } } = await supabase.auth.getSession();\n'
             '      const res = await fetch(\n'
             '        "https://pbgvgjjuhnpsumnowuym.supabase.co/functions/v1/send-proposal",\n'
             '        {\n'
             '          method: "POST",\n'
             '          headers: {\n'
             '            "Content-Type": "application/json",\n'
             '            "Authorization": `Bearer ${session.access_token}`,\n'
             '          },\n'
             '          body: JSON.stringify({\n'
             '            customerEmail: proposal.call_log?.customer_email || "",\n'
             '            customerName:  proposal.call_log?.customer_name  || "Customer",\n'
             '            repEmail:      "",\n'
             '            repName:       proposal.call_log?.sales_name || "",\n'
             '            proposalNumber: proposal.proposal_number || proposal.id,\n'
             '            jobName:       proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",\n'
             '            signingUrl,\n'
             '          }),\n'
             '        }\n'
             '      );\n'
             '      if (!res.ok) throw new Error(await res.text());\n'
             '      setSendDone(true);\n'
             '    } catch (e) {\n'
             '      setSendError(e.message || "Send failed. Please try again.");\n'
             '    }\n'
             '    setSending(false);\n'
             '  }')

old_send_block = (
    '          {view === "send" && !sendDone && (\n'
    '            <div style={{ maxWidth: 520, margin: "0 auto" }}>\n'
    '              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>\n'
    '              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>Select the contact who will receive and sign this proposal.</div>\n'
    '              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#6B7280", fontStyle: "italic" }}>\n'
    '                Recipients will be pulled from the linked customer record. Wire-up coming in SC-30.\n'
    '              </div>\n'
    '              <button onClick={() => setSendDone(true)} style={{ width: "100%", background: "#1976D2", color: "white", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>\n'
    '                📨 Send Proposal\n'
    '              </button>\n'
    '            </div>\n'
    '          )}'
)

new_send_block = (
    '          {view === "send" && !sendDone && (\n'
    '            <div style={{ maxWidth: 520, margin: "0 auto" }}>\n'
    '              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>\n'
    '              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>This will email the customer a link to review and sign electronically.</div>\n'
    '              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#6B7280", wordBreak: "break-all" }}>\n'
    '                {signingUrl}\n'
    '              </div>\n'
    '              {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12 }}>{sendError}</div>}\n'
    '              <button onClick={handleSend} disabled={sending} style={{ width: "100%", background: sending ? "#ccc" : "#30cfac", color: "white", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: sending ? "default" : "pointer", fontFamily: "inherit" }}>\n'
    '                {sending ? "Sending…" : "📨 Send to Customer"}\n'
    '              </button>\n'
    '            </div>\n'
    '          )}'
)

if old_state in content:
    content = content.replace(old_state, new_state, 1)
    print("OK: state + handleSend added")
else:
    print("FAIL: state not found")

if old_send_block in content:
    content = content.replace(old_send_block, new_send_block, 1)
    print("OK: send block replaced")
else:
    print("FAIL: send block not found")

with open("src/pages/Proposals.jsx", "w") as f:
    f.write(content)

print("Done.")
