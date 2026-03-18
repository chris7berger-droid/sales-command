with open("src/pages/Proposals.jsx", "r") as f:
    content = f.read()

old = '            customerEmail: proposal.call_log?.customer_email || "",'
new = '            customerEmail: proposal.call_log?.customer_email || "chris@hdspnv.com",'

count = content.count(old)
print(f"Found {count} occurrence(s)")
content = content.replace(old, new)

with open("src/pages/Proposals.jsx", "w") as f:
    f.write(content)

print("Done.")
