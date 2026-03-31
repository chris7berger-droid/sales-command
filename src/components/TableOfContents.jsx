import { C, F } from "../lib/tokens";

const BOOK = [
  {
    ch: 1, label: "Home", id: "home",
    pages: [
      { pg: "1.1", screen: "Your Dashboard", id: "home", desc: "See your numbers at a glance — how much you've sold this month, your goals, and what needs attention today." },
    ],
  },
  {
    ch: 2, label: "Call Log", id: "calllog",
    pages: [
      { pg: "2.1", screen: "All Jobs", id: "calllog", desc: "Every job your company is working on or bidding. Use the filters to find jobs by stage — New Inquiry, Wants Bid, Has Bid, Sold, or Lost." },
      { pg: "2.2", screen: "New Inquiry", id: "calllog:new", desc: "Start a new job here. Fill in the customer, job site address, sales rep, and work types. This is always Step 1." },
      { pg: "2.3", screen: "Job Detail", id: "calllog:detail", desc: "Everything about one job — edit the details, see attached files, and jump to any proposals or invoices linked to it." },
    ],
  },
  {
    ch: 3, label: "Proposals", id: "proposals",
    pages: [
      { pg: "3.1", screen: "All Proposals", id: "proposals", desc: "All your proposals in one place. Filter by Draft, Sent, Sold, or Lost to see where things stand." },
      { pg: "3.2", screen: "Proposal Detail", id: "proposals:detail", desc: "Build out a proposal — add work type calculators, review totals, then send it to the customer for signature." },
      { pg: "3.3", screen: "Work Type Calculator", id: "proposals:wtc", desc: "This is where you price the work. Enter labor hours, burden rates, materials, travel, and markup. The total updates as you go." },
      { pg: "3.4", screen: "Send Proposal", id: "proposals:send", desc: "Preview what the customer will see, then send it. They'll get an email with a link to review and sign." },
    ],
  },
  {
    ch: 4, label: "Invoices", id: "invoices",
    pages: [
      { pg: "4.1", screen: "All Invoices", id: "invoices", desc: "Every invoice — drafted, sent, and paid. The summary cards at the top show your totals at a glance." },
      { pg: "4.2", screen: "Invoice Detail", id: "invoices:detail", desc: "View or edit one invoice. Send it to the customer, track payment status, and see Stripe/QuickBooks sync info." },
      { pg: "4.3", screen: "New Invoice", id: "invoices:new", desc: "Create an invoice from a sold proposal. Pick the proposal, choose which work types to bill, and set the billing percentage." },
    ],
  },
  {
    ch: 5, label: "Sales Dash", id: "dashboard",
    pages: [
      { pg: "5.1", screen: "Goals & Pipeline", id: "dashboard", desc: "The big picture — monthly and yearly billing goals, conversion rate, and how many proposals you've sent. Click any goal card to see the details behind the number." },
      { pg: "5.2", screen: "Cash Flow Forecast", id: "dashboard:cashflow", desc: "A 12-month look at when money is expected to come in, based on proposal end dates and customer billing terms." },
      { pg: "5.3", screen: "Analytics", id: "dashboard:analytics", desc: "Break down your proposals and invoices by work type and sales rep. Use the filters to zoom in on a date range or specific work type." },
    ],
  },
  {
    ch: 6, label: "Customers", id: "customers",
    pages: [
      { pg: "6.1", screen: "All Customers", id: "customers", desc: "Your customer list — commercial and residential. Click any customer to see their jobs, proposals, and invoices." },
      { pg: "6.2", screen: "Customer Detail", id: "customers:detail", desc: "Everything about one customer — their jobs, proposals, and invoices in one place. Click any item to jump to it." },
      { pg: "6.3", screen: "Edit Customer", id: "customers:edit", desc: "Update a customer's name, contact info, billing address, and payment terms." },
    ],
  },
  {
    ch: 7, label: "Our Team", id: "team",
    pages: [
      { pg: "7.1", screen: "Team Members", id: "team", desc: "Everyone on your team — their role, email, and phone number. Add new people or edit existing members." },
    ],
  },
  {
    ch: 8, label: "Settings", id: "settings",
    pages: [
      { pg: "8.1", screen: "Company Settings", id: "settings", desc: "Your company info, default rates, billing terms, and sales goals. Everything you set here flows into proposals, invoices, and dashboards." },
    ],
  },
];

export function getPageNumber(activeId, subPage) {
  const key = subPage ? `${activeId}:${subPage}` : activeId;
  for (const ch of BOOK) {
    for (const p of ch.pages) {
      if (p.id === key) return p.pg;
    }
  }
  // Fallback: match just the chapter
  for (const ch of BOOK) {
    if (ch.id === activeId) return ch.pages[0]?.pg || "?";
  }
  return null;
}

export function PageBadge({ pageNumber, onClick }) {
  if (!pageNumber) return null;
  return (
    <button
      onClick={onClick}
      title="Table of Contents"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        zIndex: 90,
        background: C.dark,
        color: C.teal,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: 8,
        padding: "5px 10px",
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
      p. {pageNumber}
    </button>
  );
}

export function TOCOverlay({ onClose, currentPageId, onNavigate }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.80)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.linenCard,
          borderRadius: 16,
          width: 620,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          border: `1px solid ${C.borderStrong}`,
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 16px", borderBottom: `1px solid ${C.borderStrong}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Table of Contents
            </h2>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>
              Click any page to go there. You're on page {currentPageId}.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textFaint, cursor: "pointer" }}>✕</button>
        </div>

        {/* Chapters */}
        <div style={{ padding: "12px 0" }}>
          {BOOK.map(ch => (
            <div key={ch.ch}>
              {/* Chapter header */}
              <div style={{
                padding: "10px 28px 4px",
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: C.teal,
                fontFamily: F.display,
              }}>
                Chapter {ch.ch} — {ch.label}
              </div>

              {/* Pages */}
              {ch.pages.map(p => {
                const isCurrent = currentPageId === p.pg;
                return (
                  <button
                    key={p.pg}
                    onClick={() => { onNavigate(ch.id, p.id); onClose(); }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      width: "100%",
                      padding: "10px 28px",
                      background: isCurrent ? C.tealGlow : "transparent",
                      border: "none",
                      borderLeft: isCurrent ? `3px solid ${C.teal}` : "3px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = C.linenDeep; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                  >
                    {/* Page number */}
                    <span style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: isCurrent ? C.teal : C.textMuted,
                      fontFamily: F.display,
                      minWidth: 28,
                      letterSpacing: "0.04em",
                    }}>
                      {p.pg}
                    </span>

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: isCurrent ? C.textHead : C.textBody,
                        fontFamily: F.display,
                        letterSpacing: "0.02em",
                      }}>
                        {p.screen}
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: C.textFaint,
                        fontFamily: F.ui,
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}>
                        {p.desc}
                      </div>
                    </div>

                    {/* Current indicator */}
                    {isCurrent && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.teal, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
                        You're here
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.borderStrong}`, fontSize: 11, color: C.textFaint, fontFamily: F.ui, textAlign: "center" }}>
          Tap the page number in the bottom-left corner anytime to open this guide.
        </div>
      </div>
    </div>
  );
}

export { BOOK };
