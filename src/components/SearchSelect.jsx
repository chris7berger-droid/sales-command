import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { C, F } from "../lib/tokens";

const MAX_VISIBLE = 50;

/**
 * Searchable dropdown replacement for <select> with many options.
 * Uses createPortal to render the dropdown on document.body.
 */
export default function SearchSelect({ value, onChange, options, placeholder = "— Select —" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  // Track open state in a ref so the mousedown handler always sees the latest panel ref
  const panelEl = useRef(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  // Close on outside click — use refs to avoid stale closure issues with portal
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelEl.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      updatePos();
      // Small delay to let portal mount before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const allFiltered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;
  const filtered = allFiltered.slice(0, MAX_VISIBLE);
  const hasMore = allFiltered.length > MAX_VISIBLE;

  const selectedLabel = options.find(o => o.value === value)?.label;
  const maxH = open ? Math.max(200, window.innerHeight - pos.top - 16) : 400;

  function handleSelect(val) {
    onChange(val);
    setOpen(false);
    setSearch("");
  }

  const dropdown = open && createPortal(
    <div
      ref={(el) => { panelRef.current = el; panelEl.current = el; }}
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
          onChange={(e) => { e.stopPropagation(); setSearch(e.target.value); }}
          onMouseDown={(e) => e.stopPropagation()}
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
        <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => handleSelect("")} style={optionStyle(false)}>
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
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => handleSelect(opt.value)}
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
