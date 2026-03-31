import { useState } from "react";
import { C, F } from "../lib/tokens";

const BOOK = [
  {
    ch: 1, label: "Home", id: "home",
    pages: [
      { pg: "1", screen: "Your Dashboard", id: "home",
        desc: "See your numbers at a glance — how much you've sold this month, your goals, and what needs attention today.",
        features: [
          { label: "Alert banner", desc: "Tap to jump to Call Log filtered to bids due today" },
          { label: "Stage cards (New Inquiry, Wants Bid, Has Bid, Sold)", desc: "Tap any card to jump to Call Log filtered to that stage" },
          { label: "Monthly Billings goal card", desc: "Tap to open a drilldown showing the invoices behind the number" },
          { label: "Yearly Sales goal card", desc: "Tap to open a drilldown showing year-to-date sold proposals" },
          { label: "Proposals Sent goal card", desc: "Tap to see which proposals were sent this month" },
        ],
      },
    ],
  },
  {
    ch: 2, label: "Call Log", id: "calllog",
    pages: [
      { pg: "2.1", screen: "All Jobs", id: "calllog",
        desc: "Every job your company is working on or bidding. Use the filters to find jobs by stage — New Inquiry, Wants Bid, Has Bid, Sold, or Lost.",
        features: [
          { label: "+ New Inquiry button", desc: "Opens the multi-step job creation wizard" },
          { label: "Search bar", desc: "Type to filter jobs by job number, customer name, or job name" },
          { label: "Stage filter pills", desc: "Tap a stage (New Inquiry, Wants Bid, Has Bid, Sold, Lost) to filter the list — each shows a count" },
          { label: "Job # column (clickable)", desc: "Opens the job detail view for that job" },
          { label: "CO badge", desc: "Indicates this job is a change order" },
          { label: "No Site Addr badge", desc: "Warning that jobsite address is missing — required before creating a proposal" },
          { label: "Bid Due column", desc: "Shows bid deadline — turns red if overdue" },
          { label: "Follow Up column", desc: "Shows follow-up date — turns red if overdue" },
          { label: "View button (per row)", desc: "Opens the job detail view" },
        ],
      },
      { pg: "2.2", screen: "New Inquiry", id: "calllog:new",
        desc: "Start a new job here. A step-by-step wizard walks you through everything needed to create a job.",
        features: [
          { label: "Job Type step", desc: "Choose Standard Job, Manager Override (custom job #), or Change Order" },
          { label: "Customer step", desc: "Pick an existing customer or create a new one — Commercial or Residential" },
          { label: "Contact Info step", desc: "Enter phone, email, billing contact, and billing terms" },
          { label: "Addresses step", desc: "Enter business address, jobsite address, and billing address" },
          { label: "Sales Rep & Stage step", desc: "Assign a sales rep and set the initial stage" },
          { label: "Work Types step", desc: "Check off which work types apply to this job" },
          { label: "Bid Due & Follow Up steps", desc: "Set deadlines for bid submission and follow-up reminders" },
          { label: "Notes & Attachments step", desc: "Add notes and upload photos, PDFs, or documents" },
          { label: "← Back / Next → buttons", desc: "Navigate between wizard steps — nothing saves until the final step" },
          { label: "Save Inquiry button", desc: "Creates the job and all related records" },
        ],
      },
      { pg: "2.3", screen: "Job Detail", id: "calllog:detail",
        desc: "Everything about one job — edit the details, see attached files, and jump to any proposals or invoices linked to it.",
        features: [
          { label: "← Back button", desc: "Returns to the jobs list" },
          { label: "Edit fields", desc: "Inline editing for stage, sales rep, bid due, follow-up, addresses, and more" },
          { label: "File upload", desc: "Drag or tap to attach photos, PDFs, or documents to the job" },
          { label: "Linked proposals", desc: "Shows proposals tied to this job — tap to jump to the proposal" },
          { label: "Linked invoices", desc: "Shows invoices tied to this job — tap to jump to the invoice" },
          { label: "Delete button", desc: "Permanently deletes the job and its linked records" },
        ],
      },
    ],
  },
  {
    ch: 3, label: "Proposals", id: "proposals",
    pages: [
      { pg: "3.1", screen: "All Proposals", id: "proposals",
        desc: "All your proposals in one place. Filter by Draft, Sent, Sold, or Lost to see where things stand.",
        features: [
          { label: "+ New Proposal button", desc: "Opens a modal to select a job and create a new proposal" },
          { label: "Status filter tabs (All, Draft, Sent, Sold, Lost)", desc: "Filter proposals by status — each tab shows a count" },
          { label: "Proposal # column (clickable)", desc: "Opens the proposal detail view" },
          { label: "Row click", desc: "Tap any row to open that proposal's detail view" },
        ],
      },
      { pg: "3.2", screen: "Proposal Detail", id: "proposals:detail",
        desc: "Build out a proposal — add work type calculators, review totals, then send it to the customer for signature.",
        features: [
          { label: "← Back button", desc: "Returns to the proposals list" },
          { label: "Edit WTC button (per work type)", desc: "Opens the Work Type Calculator for that line item" },
          { label: "Checklist toggle", desc: "Expand or collapse the proposal readiness checklist" },
          { label: "Delete WTC button", desc: "Removes a work type calculator from the proposal" },
          { label: "Internal Approve button", desc: "Opens a modal to mark the proposal as internally approved (Sold)" },
          { label: "Generate PDF button", desc: "Opens a full-screen preview of the proposal PDF" },
          { label: "Send Proposal button", desc: "Opens the PDF preview with the option to email it to the customer" },
          { label: "Pull Back button", desc: "Reverts a Sent or Sold proposal back to Draft status" },
          { label: "Delete button", desc: "Permanently deletes the proposal" },
          { label: "Download Signed PDF link", desc: "Downloads the customer-signed PDF (only visible on signed proposals)" },
        ],
      },
      { pg: "3.3", screen: "Work Type Calculator", id: "proposals:wtc",
        desc: "This is where you price the work. Enter labor hours, burden rates, materials, travel, and markup. The total updates as you go.",
        features: [
          { label: "Labor section", desc: "Enter regular hours, OT hours, burden rates, and prevailing wage toggle" },
          { label: "Materials rows", desc: "Add line items for materials — description, quantity, unit price, tax, freight" },
          { label: "+ Add Material button", desc: "Adds a new blank material row" },
          { label: "Travel section", desc: "Enter per diem, mileage, lodging, and other travel costs" },
          { label: "Markup % field", desc: "Set the markup percentage — the total updates live" },
          { label: "Discount field", desc: "Enter a discount amount and reason" },
          { label: "Scope of Work (Sales SOW) field", desc: "Describe the work for the customer-facing proposal" },
          { label: "Field SOW section", desc: "Internal field notes — not shown on the proposal" },
          { label: "Sub Areas section", desc: "Break the work into named sub-areas with measurements" },
          { label: "Date range (Start / End)", desc: "Set projected start and end dates for this work type" },
          { label: "Lock toggle", desc: "Locks the WTC to prevent accidental edits" },
          { label: "Save button", desc: "Saves all changes to this work type calculator" },
        ],
      },
      { pg: "3.4", screen: "Send Proposal", id: "proposals:send",
        desc: "Preview what the customer will see, then send it. They'll get an email with a link to review and sign.",
        features: [
          { label: "PDF preview", desc: "Full preview of the proposal exactly as the customer will see it" },
          { label: "Print button", desc: "Opens the browser print dialog" },
          { label: "Send to Customer button", desc: "Switches to the send view with email and signing link" },
          { label: "Customer email field", desc: "Confirm or edit the recipient email address" },
          { label: "Send button", desc: "Sends the proposal email with a signing link" },
          { label: "← Back to Preview button", desc: "Returns to the PDF preview without sending" },
        ],
      },
    ],
  },
  {
    ch: 4, label: "Invoices", id: "invoices",
    pages: [
      { pg: "4.1", screen: "All Invoices", id: "invoices",
        desc: "Every invoice — drafted, sent, and paid. The summary cards at the top show your totals at a glance.",
        features: [
          { label: "+ New Invoice button", desc: "Opens a modal to create an invoice from a sold proposal" },
          { label: "Summary cards (Drafted, Pending, Paid)", desc: "At-a-glance totals for each invoice status" },
          { label: "Invoice # column (clickable)", desc: "Opens the invoice detail view" },
          { label: "Aging column", desc: "Color-coded days until due or overdue — green, amber, or red" },
          { label: "Row click", desc: "Tap any row to open that invoice" },
          { label: "QuickBooks connection", desc: "Connect to QuickBooks link or connected status indicator" },
        ],
      },
      { pg: "4.2", screen: "Invoice Detail", id: "invoices:detail",
        desc: "View or edit one invoice. Send it to the customer, track payment status, and see Stripe/QuickBooks sync info.",
        features: [
          { label: "← Invoices button", desc: "Returns to the invoices list" },
          { label: "Status action buttons", desc: "Mark as Sent, Waiting for Payment, Past Due, or Paid — each advances the status" },
          { label: "Print button", desc: "Opens the browser print dialog" },
          { label: "Send Invoice button", desc: "Opens the send view with email and Stripe payment link" },
          { label: "Edit button", desc: "Enters inline edit mode — change billing %, due date, discount, description" },
          { label: "Pull Back button", desc: "Reverts the invoice back to New/Draft status" },
          { label: "Delete button", desc: "Permanently deletes the invoice" },
        ],
      },
      { pg: "4.3", screen: "New Invoice", id: "invoices:new",
        desc: "Create an invoice from a sold proposal. Pick the proposal, choose which work types to bill, and set the billing percentage.",
        features: [
          { label: "Proposal search", desc: "Search and select from sold proposals" },
          { label: "Work type rows", desc: "Each work type shows its total — enter a billing % or tap Bill Remaining" },
          { label: "Bill Remaining button", desc: "Auto-fills the percentage to bill whatever hasn't been invoiced yet" },
          { label: "Due Date field", desc: "Set when the invoice is due" },
          { label: "Create Invoice button", desc: "Creates the invoice with the selected line items" },
        ],
      },
    ],
  },
  {
    ch: 5, label: "Sales Dash", id: "dashboard",
    pages: [
      { pg: "5.1", screen: "Goals & Pipeline", id: "dashboard",
        desc: "The big picture — monthly and yearly billing goals, conversion rate, and how many proposals you've sent. Click any goal card to see the details behind the number.",
        features: [
          { label: "Salesperson picker", desc: "Filter the dashboard to a specific sales rep or view the whole team" },
          { label: "Goal cards (clickable)", desc: "Tap any goal to open a drilldown modal showing the items behind the number" },
          { label: "Pipeline summary", desc: "Shows total value at each stage of your pipeline" },
        ],
      },
      { pg: "5.2", screen: "Cash Flow Forecast", id: "dashboard:cashflow",
        desc: "A 12-month look at when money is expected to come in, based on proposal end dates and customer billing terms.",
        features: [
          { label: "Monthly forecast bars", desc: "Visual breakdown of expected revenue by month" },
          { label: "Salesperson picker", desc: "Filter the forecast to a specific rep" },
        ],
      },
      { pg: "5.3", screen: "Analytics", id: "dashboard:analytics",
        desc: "Break down your proposals and invoices by work type and sales rep. Use the filters to zoom in on a date range or specific work type.",
        features: [
          { label: "Date range filter", desc: "Narrow the analytics to a specific time period" },
          { label: "Work type filter", desc: "Focus on a single work type across all proposals" },
          { label: "Breakdown charts", desc: "Visual charts showing volume and value by rep and work type" },
        ],
      },
    ],
  },
  {
    ch: 6, label: "Customers", id: "customers",
    pages: [
      { pg: "6.1", screen: "All Customers", id: "customers",
        desc: "Your customer list — commercial and residential. Click any customer to see their jobs, proposals, and invoices.",
        features: [
          { label: "+ Add Customer button", desc: "Opens a modal to create a new customer record" },
          { label: "Customer name (clickable)", desc: "Opens the customer detail view" },
          { label: "Row click", desc: "Tap any row to open that customer" },
        ],
      },
      { pg: "6.2", screen: "Customer Detail", id: "customers:detail",
        desc: "Everything about one customer — their jobs, proposals, and invoices in one place. Click any item to jump to it.",
        features: [
          { label: "← Back button", desc: "Returns to the customer list" },
          { label: "Edit button", desc: "Opens the edit customer modal" },
          { label: "Jobs / Proposals / Invoices tabs", desc: "Switch between the three data views for this customer" },
          { label: "Row clicks (in each tab)", desc: "Tap any job, proposal, or invoice to navigate directly to it" },
        ],
      },
      { pg: "6.3", screen: "Edit Customer", id: "customers:edit",
        desc: "Update a customer's name, contact info, billing address, and payment terms.",
        features: [
          { label: "Customer type toggle", desc: "Switch between Commercial and Residential" },
          { label: "Contact fields", desc: "Edit name, phone, email, and billing contact info" },
          { label: "Billing terms dropdown", desc: "Set standard terms (Net 30, etc.) or enter custom days" },
          { label: "Address fields", desc: "Edit business address and billing address" },
          { label: "Save Changes button", desc: "Saves all edits to the customer record" },
        ],
      },
    ],
  },
  {
    ch: 7, label: "Our Team", id: "team",
    pages: [
      { pg: "7", screen: "Team Members", id: "team",
        desc: "Everyone on your team — their role, email, and phone number. Add new people or edit existing members.",
        features: [
          { label: "+ Add Member button", desc: "Opens a modal to add a new team member" },
          { label: "Edit button (per card)", desc: "Opens the edit modal for that team member" },
          { label: "Email link (per card)", desc: "Opens your email client to send them a message" },
          { label: "Add & Send Invite button", desc: "Creates the member and sends them an invite email to set their password" },
          { label: "Send Invite button (edit mode)", desc: "Re-sends the invite email to a member who hasn't set up their account" },
          { label: "Active toggle (edit mode)", desc: "Deactivate a member to revoke their access without deleting them" },
          { label: "Delete button (edit mode)", desc: "Permanently removes the team member" },
        ],
      },
    ],
  },
  {
    ch: 8, label: "Settings", id: "settings",
    pages: [
      { pg: "8", screen: "Company Settings", id: "settings",
        desc: "Your company info, default rates, billing terms, and sales goals. Everything you set here flows into proposals, invoices, and dashboards.",
        features: [
          { label: "Company Info section", desc: "Edit company name, tagline, logo, license #, phone, email, website, and address" },
          { label: "Financial Defaults section", desc: "Set default burden rate, OT burden rate, tax rate, billing terms, and proposal validity" },
          { label: "Sales Goals section", desc: "Set monthly billing, yearly billing, conversion rate, and proposals sent targets" },
          { label: "Save Changes button", desc: "Saves all settings — changes flow into new proposals and dashboard calculations" },
        ],
      },
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

export function TOCOverlay({ onClose, currentPageId, onNavigate }) {
  const [expanded, setExpanded] = useState(null); // track which page is expanded by pg id

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
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: F.ui, marginTop: 4 }}>
              You're on page {currentPageId}. Tap any page to go there, or expand it to see every feature.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>✕</button>
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
                const isExpanded = expanded === p.pg;
                const hasFeatures = p.features && p.features.length > 0;

                return (
                  <div key={p.pg}>
                    {/* Page row */}
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
                      {/* Page number */}
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

                      {/* Content */}
                      <div style={{ flex: 1 }}>
                        {/* Screen name — clickable to navigate */}
                        <button
                          onClick={() => { onNavigate(ch.id, p.id); onClose(); }}
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
                          fontFamily: F.ui,
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}>
                          {p.desc}
                        </div>
                      </div>

                      {/* Expand / collapse button + current indicator */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 1 }}>
                        {isCurrent && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: C.teal, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            You're here
                          </span>
                        )}
                        {hasFeatures && (
                          <button
                            onClick={() => setExpanded(isExpanded ? null : p.pg)}
                            style={{
                              background: "none",
                              border: `1px solid ${isExpanded ? C.tealBorder : C.darkBorder}`,
                              borderRadius: 6,
                              padding: "3px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              color: isExpanded ? C.teal : "rgba(255,255,255,0.35)",
                              cursor: "pointer",
                              fontFamily: F.ui,
                              letterSpacing: "0.04em",
                              transition: "all 0.12s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.tealBorder; e.currentTarget.style.color = C.teal; }}
                            onMouseLeave={e => { if (!isExpanded) { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; } }}
                          >
                            {isExpanded ? "▾ Less" : "▸ More"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded features list */}
                    {isExpanded && hasFeatures && (
                      <div style={{
                        padding: "6px 28px 14px 70px",
                        background: "rgba(48,207,172,0.03)",
                        borderLeft: isCurrent ? `3px solid ${C.teal}` : "3px solid transparent",
                      }}>
                        {p.features.map((f, i) => (
                          <div key={i} style={{
                            display: "flex",
                            gap: 10,
                            padding: "5px 0",
                            borderBottom: i < p.features.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none",
                          }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "rgba(255,255,255,0.6)",
                              fontFamily: F.display,
                              flexShrink: 0,
                              minWidth: 6,
                              marginTop: 1,
                            }}>•</span>
                            <div>
                              <span style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: "rgba(255,255,255,0.7)",
                                fontFamily: F.ui,
                              }}>
                                {f.label}
                              </span>
                              <span style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.35)",
                                fontFamily: F.ui,
                              }}>
                                {" — "}{f.desc}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.darkBorder}`, fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: F.ui, textAlign: "center" }}>
          Tap the page number in the bottom-right corner anytime to open The Directory.
        </div>
      </div>
    </div>
  );
}

export { BOOK };
