path = "src/pages/WTCCalculator.jsx"
with open(path, "r") as f:
    src = f.read()

src = src.replace(
    'style={{ flex: 1, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.gray900, outline: "none", fontFamily: "inherit" }}',
    'style={{ flex: 1, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.gray900, outline: "none", fontFamily: "inherit", background: "#bfb3a1" }}'
)

with open(path, "w") as f:
    f.write(src)

print("Done.")chrisberger@Mac sales-command % python3 fix_pdf.py
/Library/Developer/CommandLineTools/usr/bin/python3: can't open file '/Users/chrisberger/sales-command/fix_pdf.py': [Errno 2] No such file or directory
chrisberger@Mac sales-command % 










