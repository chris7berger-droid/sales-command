with open("src/App.jsx", "r") as f:
    content = f.read()

old_imports = 'import { useState, useEffect } from "react";'
new_imports = ('import { useState, useEffect } from "react";\n'
               'import { BrowserRouter, Routes, Route } from "react-router-dom";\n'
               'import PublicSigningPage from "./pages/PublicSigningPage";')

old_return = ('  return (\n'
              '    <>\n'
              '      <style>{GLOBAL_CSS}</style>\n'
              '      <div style={{ display: "flex", height: "100vh", background: C.linen, overflow: "hidden" }}>')

new_return = ('  return (\n'
              '    <BrowserRouter>\n'
              '      <Routes>\n'
              '        <Route path="/sign/:token" element={<PublicSigningPage />} />\n'
              '        <Route path="*" element={\n'
              '          <AppShell\n'
              '            active={active} setActive={setActive}\n'
              '            open={open} setOpen={setOpen}\n'
              '            displayName={displayName} displayRole={displayRole}\n'
              '            displayInitials={displayInitials} page={page}\n'
              '          />\n'
              '        } />\n'
              '      </Routes>\n'
              '    </BrowserRouter>\n'
              '  );\n'
              '}\n'
              '\n'
              'function AppShell({ active, setActive, open, setOpen, displayName, displayRole, displayInitials, page }) {\n'
              '  return (\n'
              '    <>\n'
              '      <style>{GLOBAL_CSS}</style>\n'
              '      <div style={{ display: "flex", height: "100vh", background: C.linen, overflow: "hidden" }}>')

if old_imports in content:
    content = content.replace(old_imports, new_imports, 1)
    print("OK: imports updated")
else:
    print("FAIL: imports not found")

if old_return in content:
    content = content.replace(old_return, new_return, 1)
    print("OK: return updated")
else:
    print("FAIL: return not found")

with open("src/App.jsx", "w") as f:
    f.write(content)

print("Done.")
