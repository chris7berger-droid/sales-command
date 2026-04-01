import { useState, useEffect, useRef, useCallback } from "react";
import { C, F } from "../lib/tokens";

const BOOK = [
  {
    ch: 1, label: "Home", id: "home",
    pages: [
      { pg: "1", screen: "Your Dashboard", id: "home",
        desc: "See your numbers at a glance — how much you've sold this month, your goals, and what needs attention today.",
        features: [
          { label: "Alert banner", desc: "Tap to jump to Call Log filtered to bids due today",
            steps: ["1. Look for the amber alert bar at the top of the dashboard", "2. Tap it to jump to Call Log showing only bids due today"] },
          { label: "Stage cards (New Inquiry, Wants Bid, Has Bid, Sold)", desc: "Tap any card to jump to Call Log filtered to that stage",
            steps: ["1. Find the row of stage cards near the top", "2. Tap any card (e.g. Wants Bid)", "3. You'll land on Call Log filtered to that stage"] },
          { label: "Monthly Billings goal card", desc: "Tap to open a drilldown showing the invoices behind the number",
            steps: ["1. Scroll to the Goals section", "2. Tap the Monthly Billings card", "3. A modal opens listing the invoices that make up the total"] },
          { label: "Yearly Sales goal card", desc: "Tap to open a drilldown showing year-to-date sold proposals",
            steps: ["1. Scroll to the Goals section", "2. Tap the Yearly Sales card", "3. A modal opens listing sold proposals for the year"] },
          { label: "Proposals Sent goal card", desc: "Tap to see which proposals were sent this month",
            steps: ["1. Scroll to the Goals section", "2. Tap the Proposals Sent card", "3. A modal opens listing proposals sent this month"] },
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
          { label: "+ New Inquiry button", desc: "Opens the multi-step job creation wizard",
            steps: ["1. Go to Call Log from the sidebar", "2. Tap '+ New Inquiry' in the top right", "3. The wizard opens — follow the steps to create a job"] },
          { label: "Search bar", desc: "Type to filter jobs by job number, customer name, or job name",
            steps: ["1. Go to Call Log", "2. Start typing in the search field at the top", "3. Results filter in real time as you type"] },
          { label: "Stage filter pills", desc: "Tap a stage (New Inquiry, Wants Bid, Has Bid, Sold, Lost) to filter the list — each shows a count",
            steps: ["1. Go to Call Log", "2. Find the row of stage pills below the header", "3. Tap a pill to filter — tap 'All' to clear the filter"] },
          { label: "Job # column (clickable)", desc: "Opens the job detail view for that job",
            steps: ["1. Go to Call Log", "2. Find the job in the list", "3. Tap the job number (left column) to open the detail view"] },
          { label: "CO badge", desc: "Indicates this job is a change order",
            steps: ["1. Go to Call Log", "2. Look for the purple 'CO' badge next to a job number", "3. This means the job is a change order linked to a parent job"] },
          { label: "No Site Addr badge", desc: "Warning that jobsite address is missing — required before creating a proposal",
            steps: ["1. Go to Call Log", "2. Look for the amber 'No Site Addr' badge next to a job number", "3. Open the job and add a jobsite address before creating a proposal"] },
          { label: "Bid Due column", desc: "Shows bid deadline — turns red if overdue",
            steps: ["1. Go to Call Log", "2. Look at the Bid Due column on the right side of the table", "3. Red text means the bid is overdue"] },
          { label: "Follow Up column", desc: "Shows follow-up date — turns red if overdue",
            steps: ["1. Go to Call Log", "2. Look at the Follow Up column on the right side of the table", "3. Red text means the follow-up is overdue"] },
          { label: "View button (per row)", desc: "Opens the job detail view",
            steps: ["1. Go to Call Log", "2. Find the job in the list", "3. Tap 'View' on the right side of the row"] },
        ],
      },
      { pg: "2.2", screen: "New Inquiry", id: "calllog:new",
        desc: "Start a new job here. A step-by-step wizard walks you through everything needed to create a job.",
        features: [
          { label: "Job Type step", desc: "Choose Standard Job, Manager Override (custom job #), or Change Order",
            steps: ["1. Open the New Inquiry wizard from Call Log", "2. Choose your job type on the first step", "3. Standard Job auto-assigns the next job number"] },
          { label: "Customer step", desc: "Pick an existing customer or create a new one — Commercial or Residential",
            steps: ["1. Advance to the Customer step in the wizard", "2. Choose 'Existing Customer' to pick from a dropdown", "3. Or choose 'New Customer' and fill in their info"] },
          { label: "Contact Info step", desc: "Enter phone, email, billing contact, and billing terms",
            steps: ["1. Advance to the Contact Info step", "2. Enter phone and email", "3. Toggle 'Billing contact is the same' or enter separate billing info", "4. Set billing terms (default is Net 30)"] },
          { label: "Addresses step", desc: "Enter business address, jobsite address, and billing address",
            steps: ["1. Advance to the Addresses step", "2. Enter the business address", "3. Enter the jobsite address (required for proposals)", "4. Billing address can be set to 'Same as business'"] },
          { label: "Sales Rep & Stage step", desc: "Assign a sales rep and set the initial stage",
            steps: ["1. Advance to the Sales Rep step", "2. Pick a sales rep from the dropdown", "3. Tap a stage pill to set the initial status"] },
          { label: "Work Types step", desc: "Check off which work types apply to this job",
            steps: ["1. Advance to the Work Types step", "2. Check the boxes for each work type that applies", "3. These will be available when creating proposals later"] },
          { label: "Bid Due & Follow Up steps", desc: "Set deadlines for bid submission and follow-up reminders",
            steps: ["1. Advance to the Bid Due step and pick a date", "2. On the Follow Up step, choose Yes or No", "3. If Yes, pick a follow-up date — it'll show on the Call Log and dashboard"] },
          { label: "Notes & Attachments step", desc: "Add notes and upload photos, PDFs, or documents",
            steps: ["1. Advance to the final step", "2. Type any notes in the text area", "3. Tap '+ Add Files / Photos' to attach documents", "4. Tap 'Save Inquiry' to create the job"] },
          { label: "← Back / Next → buttons", desc: "Navigate between wizard steps — nothing saves until the final step",
            steps: ["1. Use '← Back' to revisit a previous step", "2. Use 'Next →' to advance", "3. Nothing is saved until you tap 'Save Inquiry' on the last step"] },
          { label: "Save Inquiry button", desc: "Creates the job and all related records",
            steps: ["1. Complete all required steps in the wizard", "2. Tap 'Save Inquiry' on the last step", "3. The job, customer, and work type records are all created at once"] },
        ],
      },
      { pg: "2.3", screen: "Job Detail", id: "calllog:detail",
        desc: "Everything about one job — edit the details, see attached files, and jump to any proposals or invoices linked to it.",
        features: [
          { label: "← Back button", desc: "Returns to the jobs list",
            steps: ["1. Tap '← Back' in the top left of the detail view", "2. You'll return to the Call Log list"] },
          { label: "Edit fields", desc: "Inline editing for stage, sales rep, bid due, follow-up, addresses, and more",
            steps: ["1. Open a job from the Call Log", "2. Tap any editable field to change it", "3. Changes save automatically"] },
          { label: "File upload", desc: "Drag or tap to attach photos, PDFs, or documents to the job",
            steps: ["1. Open a job from the Call Log", "2. Scroll to the Attachments section", "3. Drag files into the drop zone or tap to browse"] },
          { label: "Linked proposals", desc: "Shows proposals tied to this job — tap to jump to the proposal",
            steps: ["1. Open a job from the Call Log", "2. Scroll to the Proposals section", "3. Tap any proposal to navigate to its detail view"] },
          { label: "Linked invoices", desc: "Shows invoices tied to this job — tap to jump to the invoice",
            steps: ["1. Open a job from the Call Log", "2. Scroll to the Invoices section", "3. Tap any invoice to navigate to its detail view"] },
          { label: "Delete button", desc: "Permanently deletes the job and its linked records",
            steps: ["1. Open a job from the Call Log", "2. Tap the Delete button", "3. Confirm in the dialog — this cannot be undone"] },
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
          { label: "+ New Proposal button", desc: "Opens a modal to select a job and create a new proposal",
            steps: ["1. Go to Proposals from the sidebar", "2. Tap '+ New Proposal' in the top right", "3. Search for a job, select it, then tap 'Create Proposal'"] },
          { label: "Status filter tabs (All, Draft, Sent, Sold, Lost)", desc: "Filter proposals by status — each tab shows a count",
            steps: ["1. Go to Proposals", "2. Tap a status tab at the top of the list", "3. The list filters to that status — tap 'All' to clear"] },
          { label: "Proposal # column (clickable)", desc: "Opens the proposal detail view",
            steps: ["1. Go to Proposals", "2. Find the proposal in the list", "3. Tap the proposal number to open the detail view"] },
          { label: "Row click", desc: "Tap any row to open that proposal's detail view",
            steps: ["1. Go to Proposals", "2. Tap anywhere on a row to open that proposal"] },
        ],
      },
      { pg: "3.2", screen: "Proposal Detail", id: "proposals:detail",
        desc: "Build out a proposal — add work type calculators, review totals, then send it to the customer for signature.",
        features: [
          { label: "← Back button", desc: "Returns to the proposals list",
            steps: ["1. Tap '← Back' in the top left", "2. You'll return to the Proposals list"] },
          { label: "Edit WTC button (per work type)", desc: "Opens the Work Type Calculator for that line item",
            steps: ["1. Open a proposal", "2. Find the work type in the list", "3. Tap 'Edit WTC' to open the calculator for that line item"] },
          { label: "Checklist toggle", desc: "Expand or collapse the proposal readiness checklist",
            steps: ["1. Open a proposal", "2. Tap 'Checklist' to expand or 'Hide Checklist' to collapse", "3. Checklist items link to relevant sections"] },
          { label: "Delete WTC button", desc: "Removes a work type calculator from the proposal",
            steps: ["1. Open a proposal", "2. Find the work type you want to remove", "3. Tap 'Delete' next to that work type"] },
          { label: "Internal Approve button", desc: "Opens a modal to mark the proposal as internally approved (Sold)",
            steps: ["1. Open a proposal that hasn't been sent", "2. Tap 'Internal Approve'", "3. Select who approved it, add a reason, then confirm"] },
          { label: "Generate PDF button", desc: "Opens a full-screen preview of the proposal PDF",
            steps: ["1. Open a proposal", "2. Tap 'Generate PDF'", "3. A full-screen preview appears — you can print from here"] },
          { label: "Send Proposal button", desc: "Opens the PDF preview with the option to email it to the customer",
            steps: ["1. Open a proposal", "2. Tap 'Send Proposal'", "3. Preview the PDF, then tap 'Send to Customer' to email it"] },
          { label: "Pull Back button", desc: "Reverts a Sent or Sold proposal back to Draft status",
            steps: ["1. Open a Sent or Sold proposal", "2. Tap 'Pull Back'", "3. The proposal reverts to Draft — you can edit and re-send"] },
          { label: "Delete button", desc: "Permanently deletes the proposal",
            steps: ["1. Open a proposal", "2. Tap 'Delete'", "3. Confirm in the dialog — this cannot be undone"] },
          { label: "Download Signed PDF link", desc: "Downloads the customer-signed PDF (only visible on signed proposals)",
            steps: ["1. Open a proposal that has been signed", "2. Look for the 'Download Signed PDF' link in the summary section", "3. Tap it to download"] },
        ],
      },
      { pg: "3.3", screen: "Work Type Calculator", id: "proposals:wtc",
        desc: "This is where you price the work. Enter labor hours, burden rates, materials, travel, and markup. The total updates as you go.",
        features: [
          { label: "Labor section", desc: "Enter regular hours, OT hours, burden rates, and prevailing wage toggle",
            steps: ["1. Open a WTC from a proposal", "2. Fill in Regular Hours and OT Hours", "3. Set Burden Rate and OT Burden Rate (defaults come from Settings)", "4. Toggle Prevailing Wage if applicable"] },
          { label: "Materials rows", desc: "Add line items for materials — description, quantity, unit price, tax, freight",
            steps: ["1. Open a WTC", "2. Scroll to the Materials section", "3. Fill in description, quantity, unit price, tax %, and freight for each row"] },
          { label: "+ Add Material button", desc: "Adds a new blank material row",
            steps: ["1. Open a WTC", "2. Scroll to the Materials section", "3. Tap '+ Add Material' to add a new blank row"] },
          { label: "Travel section", desc: "Enter per diem, mileage, lodging, and other travel costs",
            steps: ["1. Open a WTC", "2. Scroll to the Travel section", "3. Fill in per diem, mileage, lodging, and other travel line items"] },
          { label: "Markup % field", desc: "Set the markup percentage — the total updates live",
            steps: ["1. Open a WTC", "2. Find the Markup % field", "3. Enter the markup — the total at the bottom updates immediately"] },
          { label: "Discount field", desc: "Enter a discount amount and reason",
            steps: ["1. Open a WTC", "2. Find the Discount field", "3. Enter a dollar amount and a reason — this subtracts from the total"] },
          { label: "Scope of Work (Sales SOW) field", desc: "Describe the work for the customer-facing proposal",
            steps: ["1. Open a WTC", "2. Scroll to the Scope of Work section", "3. Type the description — this appears on the customer-facing proposal PDF"] },
          { label: "Field SOW section", desc: "Internal field notes — not shown on the proposal",
            steps: ["1. Open a WTC", "2. Scroll to the Field SOW section", "3. Add internal notes for the field crew — these are not shown to the customer"] },
          { label: "Sub Areas section", desc: "Break the work into named sub-areas with measurements",
            steps: ["1. Open a WTC", "2. Scroll to the Sub Areas section", "3. Add named areas with measurements to break down the scope"] },
          { label: "Date range (Start / End)", desc: "Set projected start and end dates for this work type",
            steps: ["1. Open a WTC", "2. Find the Start Date and End Date fields", "3. Pick dates — these feed into the Cash Flow Forecast on Sales Dash"] },
          { label: "Lock toggle", desc: "Locks the WTC to prevent accidental edits",
            steps: ["1. Open a WTC", "2. Tap the Lock toggle", "3. When locked, all fields are read-only until you unlock it"] },
          { label: "Save button", desc: "Saves all changes to this work type calculator",
            steps: ["1. Make your changes in the WTC", "2. Tap 'Save' at the bottom", "3. Changes are saved and the proposal total updates"] },
        ],
      },
      { pg: "3.4", screen: "Send Proposal", id: "proposals:send",
        desc: "Preview what the customer will see, then send it. They'll get an email with a link to review and sign.",
        features: [
          { label: "PDF preview", desc: "Full preview of the proposal exactly as the customer will see it",
            steps: ["1. Open a proposal and tap 'Send Proposal' or 'Generate PDF'", "2. The full PDF preview renders on screen"] },
          { label: "Print button", desc: "Opens the browser print dialog",
            steps: ["1. Open the PDF preview", "2. Tap the Print button in the header", "3. Your browser's print dialog opens"] },
          { label: "Send to Customer button", desc: "Switches to the send view with email and signing link",
            steps: ["1. Open the PDF preview", "2. Tap 'Send to Customer' in the header", "3. The send view appears with the customer's email and signing URL"] },
          { label: "Customer email field", desc: "Confirm or edit the recipient email address",
            steps: ["1. Open the send view", "2. Check the email address — it's pulled from the customer's contact email", "3. Edit it if needed before sending"] },
          { label: "Send button", desc: "Sends the proposal email with a signing link",
            steps: ["1. Confirm the email address in the send view", "2. Tap 'Send'", "3. The customer receives an email with a link to review and sign"] },
          { label: "← Back to Preview button", desc: "Returns to the PDF preview without sending",
            steps: ["1. From the send view, tap '← Back to Preview'", "2. You'll return to the PDF preview — nothing is sent"] },
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
          { label: "+ New Invoice button", desc: "Opens a modal to create an invoice from a sold proposal",
            steps: ["1. Go to Invoices from the sidebar", "2. Tap '+ New Invoice' in the top right", "3. Search for a sold proposal, select it, then set billing %"] },
          { label: "Summary cards (Drafted, Pending, Paid)", desc: "At-a-glance totals for each invoice status",
            steps: ["1. Go to Invoices", "2. The summary cards are at the top of the page", "3. They show total dollar amounts for each status"] },
          { label: "Invoice # column (clickable)", desc: "Opens the invoice detail view",
            steps: ["1. Go to Invoices", "2. Find the invoice in the list", "3. Tap the invoice number badge to open the detail view"] },
          { label: "Aging column", desc: "Color-coded days until due or overdue — green, amber, or red",
            steps: ["1. Go to Invoices", "2. Look at the Aging column on the right side", "3. Green = upcoming, amber = due soon, red = overdue"] },
          { label: "Row click", desc: "Tap any row to open that invoice",
            steps: ["1. Go to Invoices", "2. Tap anywhere on a row to open that invoice"] },
          { label: "QuickBooks connection", desc: "Connect to QuickBooks link or connected status indicator",
            steps: ["1. Go to Invoices", "2. Look for the QuickBooks status in the header area", "3. If not connected, tap 'Connect QuickBooks' to start the auth flow"] },
        ],
      },
      { pg: "4.2", screen: "Invoice Detail", id: "invoices:detail",
        desc: "View or edit one invoice. Send it to the customer, track payment status, and see Stripe/QuickBooks sync info.",
        features: [
          { label: "← Invoices button", desc: "Returns to the invoices list",
            steps: ["1. Tap '← Invoices' in the top left", "2. You'll return to the Invoices list"] },
          { label: "Status action buttons", desc: "Mark as Sent, Waiting for Payment, Past Due, or Paid — each advances the status",
            steps: ["1. Open an invoice", "2. Find the status action buttons at the top", "3. Tap the next status button to advance (e.g. 'Mark as Sent')"] },
          { label: "Print button", desc: "Opens the browser print dialog",
            steps: ["1. Open an invoice", "2. Tap the Print button", "3. Your browser's print dialog opens"] },
          { label: "Send Invoice button", desc: "Opens the send view with email and Stripe payment link",
            steps: ["1. Open a New invoice", "2. Tap 'Send Invoice'", "3. Confirm the email, then tap 'Send Invoice with Pay Link'"] },
          { label: "Edit button", desc: "Enters inline edit mode — change billing %, due date, discount, description",
            steps: ["1. Open an invoice", "2. Tap 'Edit'", "3. Change any fields, then tap 'Save Changes'"] },
          { label: "Pull Back button", desc: "Reverts the invoice back to New/Draft status",
            steps: ["1. Open a Sent or later-stage invoice", "2. Tap 'Pull Back'", "3. The invoice reverts to New status — you can edit and re-send"] },
          { label: "Delete button", desc: "Permanently deletes the invoice",
            steps: ["1. Open an invoice", "2. Tap 'Delete'", "3. Confirm in the dialog — this cannot be undone"] },
        ],
      },
      { pg: "4.3", screen: "New Invoice", id: "invoices:new",
        desc: "Create an invoice from a sold proposal. Pick the proposal, choose which work types to bill, and set the billing percentage.",
        features: [
          { label: "Proposal search", desc: "Search and select from sold proposals",
            steps: ["1. Tap '+ New Invoice' from the Invoices list", "2. Type in the search field to filter sold proposals", "3. Tap a proposal to select it"] },
          { label: "Work type rows", desc: "Each work type shows its total — enter a billing % or tap Bill Remaining",
            steps: ["1. Select a proposal in the New Invoice modal", "2. Each work type from the proposal appears as a row", "3. Enter a billing % for each one you want to include"] },
          { label: "Bill Remaining button", desc: "Auto-fills the percentage to bill whatever hasn't been invoiced yet",
            steps: ["1. In the New Invoice modal, find a work type row", "2. Tap 'Bill Remaining' next to it", "3. The % auto-fills to whatever hasn't been billed yet"] },
          { label: "Due Date field", desc: "Set when the invoice is due",
            steps: ["1. In the New Invoice modal", "2. Find the Due Date field", "3. Pick a date — defaults to billing terms from the customer"] },
          { label: "Create Invoice button", desc: "Creates the invoice with the selected line items",
            steps: ["1. Set billing % on at least one work type", "2. Set the due date", "3. Tap 'Create Invoice' to finalize"] },
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
          { label: "Salesperson picker", desc: "Filter the dashboard to a specific sales rep or view the whole team",
            steps: ["1. Go to Sales Dash from the sidebar", "2. Find the salesperson dropdown at the top", "3. Select a rep to filter, or choose 'All' for the full team"] },
          { label: "Goal cards (clickable)", desc: "Tap any goal to open a drilldown modal showing the items behind the number",
            steps: ["1. Go to Sales Dash", "2. Tap any goal card (Monthly Billings, Yearly Sales, etc.)", "3. A modal opens listing the individual items that make up that number"] },
          { label: "Pipeline summary", desc: "Shows total value at each stage of your pipeline",
            steps: ["1. Go to Sales Dash", "2. Scroll to the Pipeline section", "3. See the total dollar value at each stage"] },
        ],
      },
      { pg: "5.2", screen: "Cash Flow Forecast", id: "dashboard:cashflow",
        desc: "A 12-month look at when money is expected to come in, based on proposal end dates and customer billing terms.",
        features: [
          { label: "Monthly forecast bars", desc: "Visual breakdown of expected revenue by month",
            steps: ["1. Go to Sales Dash", "2. Navigate to the Cash Flow tab", "3. Each bar shows the expected revenue for that month"] },
          { label: "Salesperson picker", desc: "Filter the forecast to a specific rep",
            steps: ["1. On the Cash Flow tab", "2. Use the salesperson dropdown to filter", "3. The forecast updates to show only that rep's expected revenue"] },
        ],
      },
      { pg: "5.3", screen: "Analytics", id: "dashboard:analytics",
        desc: "Break down your proposals and invoices by work type and sales rep. Use the filters to zoom in on a date range or specific work type.",
        features: [
          { label: "Date range filter", desc: "Narrow the analytics to a specific time period",
            steps: ["1. Go to Sales Dash", "2. Navigate to the Analytics tab", "3. Use the date range picker to set start and end dates"] },
          { label: "Work type filter", desc: "Focus on a single work type across all proposals",
            steps: ["1. On the Analytics tab", "2. Use the work type dropdown", "3. The charts update to show only that work type"] },
          { label: "Breakdown charts", desc: "Visual charts showing volume and value by rep and work type",
            steps: ["1. On the Analytics tab", "2. Scroll through the charts", "3. They show breakdowns by sales rep and by work type"] },
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
          { label: "+ Add Customer button", desc: "Opens a modal to create a new customer record",
            steps: ["1. Go to Customers from the sidebar", "2. Tap '+ Add Customer' in the top right", "3. Fill in the customer info and tap 'Add Customer'"] },
          { label: "Customer name (clickable)", desc: "Opens the customer detail view",
            steps: ["1. Go to Customers", "2. Tap a customer name in the list", "3. The detail view opens showing their jobs, proposals, and invoices"] },
          { label: "Row click", desc: "Tap any row to open that customer",
            steps: ["1. Go to Customers", "2. Tap anywhere on a row to open that customer"] },
        ],
      },
      { pg: "6.2", screen: "Customer Detail", id: "customers:detail",
        desc: "Everything about one customer — their jobs, proposals, and invoices in one place. Click any item to jump to it.",
        features: [
          { label: "← Back button", desc: "Returns to the customer list",
            steps: ["1. Tap '← Back' in the top left", "2. You'll return to the Customers list"] },
          { label: "Edit button", desc: "Opens the edit customer modal",
            steps: ["1. Open a customer", "2. Tap 'Edit' in the header", "3. The edit modal opens with all their info"] },
          { label: "Jobs / Proposals / Invoices tabs", desc: "Switch between the three data views for this customer",
            steps: ["1. Open a customer", "2. Tap 'Jobs', 'Proposals', or 'Invoices' to switch tabs", "3. Each tab shows that customer's records with counts"] },
          { label: "Row clicks (in each tab)", desc: "Tap any job, proposal, or invoice to navigate directly to it",
            steps: ["1. Open a customer and pick a tab", "2. Tap any row in the table", "3. You'll navigate directly to that job, proposal, or invoice"] },
        ],
      },
      { pg: "6.3", screen: "Edit Customer", id: "customers:edit",
        desc: "Update a customer's name, contact info, billing address, and payment terms.",
        features: [
          { label: "Customer type toggle", desc: "Switch between Commercial and Residential",
            steps: ["1. Open the Edit Customer modal", "2. Change the customer type dropdown at the top", "3. The form adjusts — Commercial shows business name, Residential shows first/last"] },
          { label: "Contact fields", desc: "Edit name, phone, email, and billing contact info",
            steps: ["1. Open the Edit Customer modal", "2. Update any contact fields", "3. Toggle 'Billing contact is the same' or enter separate billing info"] },
          { label: "Billing terms dropdown", desc: "Set standard terms (Net 30, etc.) or enter custom days",
            steps: ["1. Open the Edit Customer modal", "2. Find the Billing Terms dropdown", "3. Choose a standard option or select Custom and enter a number of days"] },
          { label: "Address fields", desc: "Edit business address and billing address",
            steps: ["1. Open the Edit Customer modal", "2. Update the address fields", "3. Tap 'Save Changes' when done"] },
          { label: "Save Changes button", desc: "Saves all edits to the customer record",
            steps: ["1. Make your changes in the Edit Customer modal", "2. Tap 'Save Changes' at the bottom"] },
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
          { label: "+ Add Member button", desc: "Opens a modal to add a new team member",
            steps: ["1. Go to Our Team from the sidebar", "2. Tap '+ Add Member' in the top right", "3. Fill in name, email, phone, and role"] },
          { label: "Edit button (per card)", desc: "Opens the edit modal for that team member",
            steps: ["1. Go to Our Team", "2. Find the member's card", "3. Tap 'Edit' on the right side of the card"] },
          { label: "Email link (per card)", desc: "Opens your email client to send them a message",
            steps: ["1. Go to Our Team", "2. Find the member's card", "3. Tap their email address to open your email client"] },
          { label: "Add & Send Invite button", desc: "Creates the member and sends them an invite email to set their password",
            steps: ["1. Tap '+ Add Member'", "2. Fill in their info", "3. Tap 'Add & Send Invite'", "4. They'll receive an email with a link to set their password"] },
          { label: "Send Invite button (edit mode)", desc: "Re-sends the invite email to a member who hasn't set up their account",
            steps: ["1. Tap 'Edit' on a member card", "2. If they haven't set up their account, you'll see 'Send Invite'", "3. Tap it to re-send the invite email"] },
          { label: "Active toggle (edit mode)", desc: "Deactivate a member to revoke their access without deleting them",
            steps: ["1. Tap 'Edit' on a member card", "2. Uncheck the Active checkbox", "3. Tap 'Save Changes' — they can no longer log in but their data is preserved"] },
          { label: "Delete button (edit mode)", desc: "Permanently removes the team member",
            steps: ["1. Tap 'Edit' on a member card", "2. Tap 'Delete' in the bottom left", "3. Confirm — this permanently removes the member"] },
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
          { label: "Company Info section", desc: "Edit company name, tagline, logo, license #, phone, email, website, and address",
            steps: ["1. Go to Settings from the sidebar", "2. Scroll to Company Info", "3. Edit any field, then tap 'Save Changes' at the bottom"] },
          { label: "Financial Defaults section", desc: "Set default burden rate, OT burden rate, tax rate, billing terms, and proposal validity",
            steps: ["1. Go to Settings", "2. Scroll to Financial Defaults", "3. These values auto-fill when creating new WTCs and proposals"] },
          { label: "Sales Goals section", desc: "Set monthly billing, yearly billing, conversion rate, and proposals sent targets",
            steps: ["1. Go to Settings", "2. Scroll to Sales Goals", "3. Set your targets — these drive the goal cards on Home and Sales Dash"] },
          { label: "Save Changes button", desc: "Saves all settings — changes flow into new proposals and dashboard calculations",
            steps: ["1. Make your changes anywhere on the Settings page", "2. Tap 'Save Changes' at the bottom", "3. New proposals and dashboards will use the updated values"] },
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
  const [expanded, setExpanded] = useState(null);
  const [expandedFeature, setExpandedFeature] = useState(null); // "pg:featureIndex"
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
                  <div key={p.pg} ref={isCurrent ? currentRef : undefined}>
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
                        {p.features.map((f, i) => {
                          const featureKey = `${p.pg}:${i}`;
                          const isFeatureExpanded = expandedFeature === featureKey;
                          const hasSteps = f.steps && f.steps.length > 0;

                          return (
                            <div key={i} style={{
                              borderBottom: i < p.features.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none",
                            }}>
                              {/* Feature bullet — clickable to toggle steps */}
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
                                }}>{isFeatureExpanded ? "▾" : hasSteps ? "▸" : "•"}</span>
                                <div>
                                  <span style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: isFeatureExpanded ? C.teal : "rgba(255,255,255,0.7)",
                                    fontFamily: F.ui,
                                    transition: "color 0.1s",
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

                              {/* Expanded steps */}
                              {isFeatureExpanded && hasSteps && (
                                <div style={{
                                  padding: "4px 0 8px 20px",
                                }}>
                                  {f.steps.map((step, si) => (
                                    <div key={si} style={{
                                      fontSize: 11.5,
                                      color: "rgba(255,255,255,0.5)",
                                      fontFamily: F.ui,
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
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.darkBorder}`, fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: F.ui, textAlign: "center" }}>
          Tap the page number in the bottom-right corner anytime to open The Directory.
        </div>
      </div>
    </div>
  );
}

export { BOOK };
