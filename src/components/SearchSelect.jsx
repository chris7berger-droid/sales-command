import { useState, useRef, useEffect } from "react";
import { C, F } from "../lib/tokens";

/**
 * Searchable dropdown replacement for <select> with many options.
 * Props:
 *   value       — currently selected value (option.value)
 *   onChange     — called with the selected option's value
 *   options      — [{ value, label }]
 *   placeholder  — text when nothing is selected
 */
export default function SearchSelect({ value, onChange, options, placeholder = "— Select —" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef();
  const inputRef = useRef();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input on open
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selectedLabel = options.find(o => o.value === value)?.label;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          width: "100%", padding: "8px 12px", borderRadius: 6,
          border: `1px solid ${C.borderStrong}`, background: C.linenDeep,
          color: selectedLabel ? C.textBody : C.textFaint,
          fontSize: 13, fontFamily: F.ui, textAlign: "left",
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "space-between", WebkitAppearance: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || placeholder}
        </span>
        <span style={{ color: C.textFaint, fontSize: 10, marginLeft: 8, flexShrink: 0 }}>▼</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: C.dark, borderRadius: 8, border: `1px solid ${C.darkBorder}`,
          zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          maxHeight: 300, display: "flex", flexDirection: "column",
        }}>
          {/* Search input */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.darkBorder}` }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search..."
              style={{
                width: "100%", padding: "6px 10px", borderRadius: 5,
                border: `1px solid ${C.darkBorder}`, background: C.darkRaised,
                color: "#fff", fontSize: 13, fontFamily: F.ui,
                outline: "none", WebkitAppearance: "none",
              }}
            />
          </div>

          {/* Options list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {/* Clear selection option */}
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              style={optionStyle(false)}
            >
              <span style={{ color: C.textFaint, fontStyle: "italic" }}>{placeholder}</span>
            </button>

            {filtered.length === 0 && (
              <div style={{ padding: "12px 14px", color: C.textFaint, fontSize: 12, fontFamily: F.ui, textAlign: "center" }}>
                No matches found
              </div>
            )}

            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={optionStyle(opt.value === value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function optionStyle(selected) {
  return {
    display: "block", width: "100%", padding: "7px 14px",
    background: selected ? C.tealDeep : "transparent",
    color: selected ? "#fff" : "rgba(255,255,255,0.85)",
    fontSize: 13, fontFamily: F.ui, textAlign: "left",
    border: "none", cursor: "pointer",
    borderBottom: `1px solid rgba(255,255,255,0.05)`,
  };
}
