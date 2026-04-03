import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { C, F } from "../lib/tokens";

/**
 * Searchable dropdown replacement for <select> with many options.
 * Uses createPortal to render the dropdown on document.body,
 * breaking out of any parent overflow clipping.
 */
export default function SearchSelect({ value, onChange, options, placeholder = "— Select —" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef();
  const panelRef = useRef();
  const inputRef = useRef();

  // Calculate position from trigger button
  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input + calc position on open
  useEffect(() => {
    if (open) {
      updatePos();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, updatePos]);

  // Recalc on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const MAX_VISIBLE = 50;
  const allFiltered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;
  const filtered = allFiltered.slice(0, MAX_VISIBLE);
  const hasMore = allFiltered.length > MAX_VISIBLE;

  const selectedLabel = options.find(o => o.value === value)?.label;

  // How tall can the dropdown be? Don't overflow below viewport.
  const maxH = open ? Math.max(200, window.innerHeight - pos.top - 16) : 400;

  const dropdown = open && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: pos.width,
        background: C.dark, borderRadius: 8, border: `1px solid ${C.darkBorder}`,
        zIndex: 99999, boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        maxHeight: maxH, display: "flex", flexDirection: "column",
      }}
    >
      {/* Search input */}
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.darkBorder}`, flexShrink: 0 }}>
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

        {hasMore && (
          <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 12, color: C.teal, fontFamily: F.ui, fontWeight: 600, borderTop: `1px solid ${C.darkBorder}` }}>
            {allFiltered.length - MAX_VISIBLE} more — type to narrow results
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div>
      {/* Trigger button */}
      <button
        ref={triggerRef}
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

      {dropdown}
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
