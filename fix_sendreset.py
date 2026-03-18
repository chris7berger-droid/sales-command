with open("src/pages/Proposals.jsx", "r") as f:
    content = f.read()

old = "  if (showPDF) return <ProposalPDFModal proposal={p} onClose={() => setShowPDF(false)} />;"
new = "  if (showPDF) return <ProposalPDFModal key={p.id + '-' + Date.now()} proposal={p} onClose={() => setShowPDF(false)} />;"

if old in content:
    content = content.replace(old, new, 1)
    print("OK: key added to ProposalPDFModal")
else:
    print("FAIL: not found")

with open("src/pages/Proposals.jsx", "w") as f:
    f.write(content)
print("Done.")
