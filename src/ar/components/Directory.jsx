import { useState, useCallback } from "react";
import { C, F } from "../lib/tokens";

const BOOK = [
  {
    ch: 1, label: "Upload", id: "upload",
    pages: [
      { pg: "1", screen: "Upload Report", id: "upload",
        desc: "Drop your QuickBooks A/R Aging Detail export here. This is your starting point every week.",
        features: [
          { label: "Drag & drop zone", desc: "Drop your .xlsx, .xls, or .csv file to load it instantly",
            steps: ["1. Go to QB Desktop \u2192 Reports \u2192 A/R Aging Detail", "2. Export as Excel (.xlsx)", "3. Drag the file onto the upload zone, or click to browse", "4. Your data loads instantly \u2014 nothing leaves your browser"] },
          { label: "New Report button (topbar)", desc: "Upload a fresh report anytime without losing your triage flags and notes",
            steps: ["1. Click 'New Report' in the top-right corner", "2. Drop the new file", "3. Your triage statuses, notes, and flags carry over"] },
        ],
      },
    ],
  },
  {
    ch: 2, label: "Triage", id: "triage",
    pages: [
      { pg: "2", screen: "Triage Customers", id: "triage",
        desc: "Power through your customer list and classify each one. This separates real money from QB noise so every other screen becomes useful.",
        features: [
          { label: "Progress bar", desc: "Shows how many customers you've triaged out of the total",
            steps: ["1. Look at the dark bar at the top of the Triage screen", "2. It shows 'X of Y customers' with a fill bar", "3. Goal: get to 100% \u2014 then every other screen is filtered and trustworthy"] },
          { label: "Status filter cards", desc: "Click any status (Untriaged, Good, Unsure, Not Right, Problem) to filter the customer list",
            steps: ["1. Find the row of cards below the progress bar", "2. Click 'Untriaged' to see what's left to review", "3. Click 'Good' to see your verified chase list", "4. Click 'Problem' to see your QB cleanup list"] },
          { label: "Customer list (left panel)", desc: "Sorted by total owed, biggest first. Colored dots show triage status.",
            steps: ["1. Scroll through the customer list on the left", "2. Gray dot = untriaged, green = good, amber = unsure, red = not right, dark red = problem", "3. Click any customer to see their detail on the right"] },
          { label: "Invoice cards (center panel)", desc: "Each invoice shows its triage status, aging bucket, amount, and job. Click to expand and triage.",
            steps: ["1. Click a customer on the left", "2. See their aging breakdown and all invoices in the center", "3. Each card shows a triage dot (gray=untriaged, green=good, amber=unsure, red=problem)", "4. Click any invoice to expand and see the triage buttons"] },
          { label: "Triage buttons (Good / Unsure / Problem)", desc: "Click any invoice to expand it, then mark it with one tap",
            steps: ["1. Click an invoice card to expand it", "2. Three buttons appear:", "   \u2022 Good \u2014 QB is accurate, chase this money", "   \u2022 Unsure \u2014 need to verify before acting", "   \u2022 Problem \u2014 dispute, wrong, or needs cleanup", "3. Click the same button again to un-triage", "4. Use 'Mark all' buttons in the header to bulk-triage a customer's invoices"] },
        ],
      },
    ],
  },
  {
    ch: 3, label: "Dashboard", id: "aging",
    pages: [
      { pg: "3", screen: "Aging Dashboard", id: "aging",
        desc: "Your aging numbers at a glance. After triage, these numbers mean something because they're built on data you've verified.",
        features: [
          { label: "Scorecard filters", desc: "Click any aging bucket or flag category to filter the customer table",
            steps: ["1. Find the row of cards at the top (All, Current, 1-30, etc.)", "2. Click a card to filter the table below", "3. Click it again or click 'All' to clear the filter"] },
          { label: "Search bar", desc: "Type to find a specific customer by name",
            steps: ["1. Type in the search field below the scorecards", "2. The table filters in real time as you type"] },
          { label: "Aging table", desc: "Sortable customer table with aging columns \u2014 click any column header to sort",
            steps: ["1. Click any column header to sort (Total, 91+, etc.)", "2. Click again to reverse the sort", "3. Click a customer row to open their detail panel"] },
          { label: "Customer detail panel", desc: "Slide-out panel with full invoice list, flags, notes, and expected payment dates",
            steps: ["1. Click any customer in the aging table", "2. The detail panel slides in from the right", "3. Expand any invoice to add flags, notes, or expected dates", "4. Click the X or overlay to close"] },
        ],
      },
    ],
  },
  {
    ch: 4, label: "Chase", id: "action",
    pages: [
      { pg: "4.1", screen: "Clean Up QB", id: "action:cleanup",
        desc: "Items making your AR report inaccurate \u2014 unapplied credits, stale balances, and potential misapplied payments. Fix these first.",
        features: [
          { label: "Priority 1 items", desc: "Large unapplied credits inflating your AR \u2014 fix this week",
            steps: ["1. Go to Chase \u2192 Clean Up QB tab", "2. Priority 1 items are at the top with red borders", "3. Click any item to see the exact fix", "4. Click 'Open Customer' to jump to their detail panel"] },
          { label: "Priority 3 items", desc: "Small stale balances \u2014 batch cleanup, 20 minutes of QB work",
            steps: ["1. Scroll past Priority 1 items", "2. Priority 3 items are small balances you can write off in bulk"] },
          { label: "Misapplied payment detection", desc: "Automatically finds customers with credits that might belong to a different customer entry",
            steps: ["1. Look for \u26a0\ufe0f items in the cleanup list", "2. These show two customer names that might be the same company", "3. Check QB to see if one customer's payment should apply to the other"] },
        ],
      },
      { pg: "4.2", screen: "Chase Cash", id: "action:chase",
        desc: "Your collection war room. Past-due invoices organized by urgency \u2014 91+ days down to current.",
        features: [
          { label: "Urgency tiers", desc: "Invoices grouped by how overdue they are, each with a recommended action",
            steps: ["1. Go to Chase \u2192 Chase Cash tab", "2. Red (91+) = escalate now, every day makes it harder", "3. Orange (61-90) = demand, involve sales contact", "4. Amber (31-60) = follow up actively", "5. Blue (1-30) = remind, normal for construction", "6. Green (current) = track, not due yet"] },
          { label: "Customer groups", desc: "Within each tier, invoices are grouped by customer \u2014 click to expand",
            steps: ["1. Find a customer group within a tier", "2. Click to expand and see individual invoices", "3. Click 'Open Customer' to jump to the detail panel"] },
        ],
      },
    ],
  },
  {
    ch: 5, label: "Health Check", id: "health",
    pages: [
      { pg: "5", screen: "Health Check", id: "health",
        desc: "Anomalies, aging breakdown, and your top customers by outstanding balance. Hand the 'Not Right' and 'Problem' list to your accountant.",
        features: [
          { label: "Anomaly detection", desc: "Flags unusual patterns \u2014 large credits, duplicate entries, retention mismatches",
            steps: ["1. Go to Health Check", "2. Review the anomaly list at the top", "3. Each item links to the customer it affects"] },
          { label: "Top customers", desc: "Ranked by total outstanding \u2014 your biggest exposures at a glance",
            steps: ["1. Scroll to the Top Customers section", "2. Click any customer to open their detail panel"] },
        ],
      },
    ],
  },
  {
    ch: 6, label: "Cash Flow", id: "cff",
    pages: [
      { pg: "6", screen: "Cash Flow Forecast", id: "cff",
        desc: "When money is expected to arrive. Scheduled invoices (with expected dates) vs. unscheduled. More useful after triage since it's built on verified data.",
        features: [
          { label: "Scheduled vs. unscheduled", desc: "Invoices with expected payment dates show in Scheduled, everything else in Unscheduled",
            steps: ["1. Go to Cash Flow", "2. Scheduled section shows invoices where you've set an expected date", "3. Unscheduled section shows everything else", "4. Set expected dates in the customer detail panel to move invoices to Scheduled"] },
          { label: "Retention section", desc: "Retention invoices shown separately since they follow a different collection timeline",
            steps: ["1. Scroll to the Retention section in Cash Flow", "2. These are invoices flagged as retention in the detail panel"] },
        ],
      },
    ],
  },
  {
    ch: 7, label: "Invoices", id: "invoices",
    pages: [
      { pg: "7", screen: "Invoice List", id: "invoices",
        desc: "Period-based view of all invoices. Navigate by week, month, quarter, or year to see invoicing volume and open balances.",
        features: [
          { label: "Period navigation", desc: "Switch between week, month, quarter, and year views \u2014 arrow buttons move forward/back",
            steps: ["1. Go to Invoices", "2. Use the period selector (Week/Month/Quarter/Year)", "3. Use the arrow buttons to navigate forward and back", "4. Summary cards show total invoiced vs. still open"] },
          { label: "Invoice rows", desc: "Click any invoice to open the customer detail panel",
            steps: ["1. Find the invoice in the list", "2. Click to open the customer detail panel with that invoice's context"] },
        ],
      },
    ],
  },
];

export function getPageNumber(activeTab) {
  for (const ch of BOOK) {
    for (const p of ch.pages) {
      if (p.id === activeTab || ch.id === activeTab) return p.pg;
    }
  }
  return "1";
}

export function PageBadge({ pageNumber, onClick }) {
  if (!pageNumber) return null;
  return (
    <button
      onClick={onClick}
      title="The Directory"
      style={{
        position: "fixed",
        bottom: 18,
        right: 18,
        zIndex: 90,
        background: C.dark,
        color: C.teal,
        border: `1.5px solid ${C.tealBorder}`,
        borderRadius: 20,
        padding: "6px 12px",
        fontSize: 11,
        fontWeight: 800,
        fontFamily: F.display,
        letterSpacing: "0.06em",
        cursor: "pointer",
        opacity: 0.7,
        transition: "opacity 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = 1}
      onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
    >
      Dir. {pageNumber}
    </button>
  );
}

export function DirectoryOverlay({ onClose, currentPageId, onNavigate }) {
  const [expanded, setExpanded] = useState(null);
  const [expandedFeature, setExpandedFeature] = useState(null);
  const currentRef = useCallback(node => {
    if (node) setTimeout(() => node.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.80)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.dark,
          borderRadius: 16,
          width: 640,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          border: `1px solid ${C.darkBorder}`,
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 16px", borderBottom: `1px solid ${C.darkBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              The Directory
            </h2>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: F.body, marginTop: 4 }}>
              Your AR workflow, step by step. Tap any page to go there.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>{"\u2715"}</button>
        </div>

        {/* Workflow hint */}
        <div style={{ padding: "12px 28px", background: "rgba(48,207,172,0.06)", borderBottom: `1px solid ${C.darkBorder}`, fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: F.body, lineHeight: 1.5 }}>
          <strong style={{ color: C.teal }}>The flow:</strong> Upload your QB report {"\u2192"} Triage every customer {"\u2192"} Chase the good money {"\u2192"} Clean up the rest.
        </div>

        {/* Chapters */}
        <div style={{ padding: "12px 0" }}>
          {BOOK.map(ch => (
            <div key={ch.ch}>
              <div style={{
                padding: "10px 28px 4px",
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: C.teal,
                fontFamily: F.display,
              }}>
                Step {ch.ch} — {ch.label}
              </div>

              {ch.pages.map(p => {
                const isCurrent = currentPageId === p.pg;
                const isExpanded = expanded === p.pg;
                const hasFeatures = p.features && p.features.length > 0;

                return (
                  <div key={p.pg} ref={isCurrent ? currentRef : undefined}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                        width: "100%",
                        padding: "10px 28px",
                        background: isCurrent ? "rgba(48,207,172,0.08)" : "transparent",
                        borderLeft: isCurrent ? `3px solid ${C.teal}` : "3px solid transparent",
                        transition: "background 0.1s",
                      }}
                    >
                      <span style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: isCurrent ? C.teal : "rgba(255,255,255,0.5)",
                        fontFamily: F.display,
                        minWidth: 28,
                        letterSpacing: "0.04em",
                        marginTop: 1,
                      }}>
                        {p.pg}
                      </span>

                      <div style={{ flex: 1 }}>
                        <button
                          onClick={() => { onNavigate(ch.id); onClose(); }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 13,
                            fontWeight: 700,
                            color: isCurrent ? C.teal : "rgba(255,255,255,0.85)",
                            fontFamily: F.display,
                            letterSpacing: "0.02em",
                          }}
                          onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.color = C.teal; }}
                          onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                        >
                          {p.screen}
                        </button>

                        <div style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.35)",
                          fontFamily: F.body,
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}>
                          {p.desc}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 1 }}>
                        {isCurrent && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: C.teal, fontFamily: F.body, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            You're here
                          </span>
                        )}
                        {hasFeatures && (
                          <button
                            onClick={() => { setExpanded(isExpanded ? null : p.pg); setExpandedFeature(null); }}
                            style={{
                              background: "none",
                              border: `1px solid ${isExpanded ? C.tealBorder : C.darkBorder}`,
                              borderRadius: 6,
                              padding: "3px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              color: isExpanded ? C.teal : "rgba(255,255,255,0.35)",
                              cursor: "pointer",
                              fontFamily: F.body,
                              letterSpacing: "0.04em",
                              transition: "all 0.12s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.tealBorder; e.currentTarget.style.color = C.teal; }}
                            onMouseLeave={e => { if (!isExpanded) { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; } }}
                          >
                            {isExpanded ? "\u25be Less" : "\u25b8 More"}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasFeatures && (
                      <div style={{
                        padding: "6px 28px 14px 70px",
                        background: "rgba(48,207,172,0.03)",
                        borderLeft: isCurrent ? `3px solid ${C.teal}` : "3px solid transparent",
                      }}>
                        {p.features.map((f, i) => {
                          const featureKey = `${p.pg}:${i}`;
                          const isFeatureExpanded = expandedFeature === featureKey;
                          const hasSteps = f.steps && f.steps.length > 0;

                          return (
                            <div key={i} style={{
                              borderBottom: i < p.features.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                            }}>
                              <div
                                onClick={() => hasSteps && setExpandedFeature(isFeatureExpanded ? null : featureKey)}
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  padding: "5px 0",
                                  cursor: hasSteps ? "pointer" : "default",
                                  borderRadius: 4,
                                }}
                              >
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: isFeatureExpanded ? C.teal : "rgba(255,255,255,0.6)",
                                  fontFamily: F.display,
                                  flexShrink: 0,
                                  minWidth: 10,
                                  marginTop: 1,
                                }}>{isFeatureExpanded ? "\u25be" : hasSteps ? "\u25b8" : "\u2022"}</span>
                                <div>
                                  <span style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: isFeatureExpanded ? C.teal : "rgba(255,255,255,0.7)",
                                    fontFamily: F.body,
                                    transition: "color 0.1s",
                                  }}>
                                    {f.label}
                                  </span>
                                  <span style={{
                                    fontSize: 12,
                                    color: "rgba(255,255,255,0.35)",
                                    fontFamily: F.body,
                                  }}>
                                    {" \u2014 "}{f.desc}
                                  </span>
                                </div>
                              </div>

                              {isFeatureExpanded && hasSteps && (
                                <div style={{ padding: "4px 0 8px 20px" }}>
                                  {f.steps.map((step, si) => (
                                    <div key={si} style={{
                                      fontSize: 11.5,
                                      color: "rgba(255,255,255,0.5)",
                                      fontFamily: F.body,
                                      padding: "3px 0",
                                      lineHeight: 1.5,
                                    }}>
                                      {step}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.darkBorder}`, fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: F.body, textAlign: "center" }}>
          Tap the page number in the bottom-right corner anytime to open The Directory.
        </div>
      </div>
    </div>
  );
}

export { BOOK };
