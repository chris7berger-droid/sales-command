import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Fill a pay-app PDF template by overlaying text at mapped coordinates.
 *
 * @param {object} opts
 * @param {Uint8Array|ArrayBuffer} opts.templateBytes - template PDF bytes
 * @param {object} opts.fieldValues - map of field keys to string values
 * @param {object} opts.fieldMap - map of field keys to { x, y, size?, page? }
 *   coordinates in PDF points (bottom-left origin), size defaults to 11, page defaults to 0
 * @returns {Promise<Uint8Array>} - filled PDF bytes
 */
export async function fillPayAppPdf({ templateBytes, fieldValues, fieldMap }) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const pages = pdfDoc.getPages();

  for (const [key, rawValue] of Object.entries(fieldValues || {})) {
    const mapping = fieldMap?.[key];
    if (!mapping) continue;
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    const { x, y, size = 11, page: pageIndex = 0, lineHeight = size + 2 } = mapping;
    const page = pages[pageIndex];
    if (!page) continue;

    // Multi-line support: split on \n, draw each line at y decreasing by lineHeight.
    const lines = String(rawValue).split('\n');
    lines.forEach((line, i) => {
      if (line) page.drawText(line, { x, y: y - i * lineHeight, size, font });
    });
  }

  return await pdfDoc.save();
}

/**
 * First-pass coordinate map for DA Builders' per-job subcontractor payment
 * application template (1-page letter, 612x792 pts, flat PDF). Coordinates are
 * eyeballed from a 150 DPI render — expect to calibrate each field by a few
 * points after first test print. All fields target page 0. Scope = 'job'.
 */
export const DEFAULT_DA_BUILDERS_JOB_FIELD_MAP = {
  // Top-right header block — "Invoice No:" and "Date:" fields
  // Top "From:" block — multi-line: company name, address, phone
  from_info: { x: 72, y: 684, size: 10, lineHeight: 12 },
  // Subcontractor Job No.: — tenant's internal job number (call_log.job_number)
  subcontractor_job_no: { x: 161, y: 642, size: 10 },

  invoice_number: { x: 375, y: 588, size: 10 },
  invoice_date: { x: 385, y: 561, size: 10 },

  // "Invoice Attached?" Yes checkbox — stamp an X inside the Yes box
  invoice_attached_yes: { x: 506, y: 588, size: 11 },

  // Contract Summary block
  // Line 1 Original Subcontract — middle $ column
  original_subcontract: { x: 345, y: 523, size: 10 },
  // Line 2 "Approved Subcontractor Changes" has no sum blank on DA's template,
  // the C/O 1-5 rows carry the detail — approved_changes_total intentionally
  // not mapped so it doesn't render.
  // C/O 1-5 rows — indented column (x=161), 13pt row pitch
  co_1: { x: 161, y: 495, size: 10 },
  co_2: { x: 161, y: 482, size: 10 },
  co_3: { x: 161, y: 469, size: 10 },
  co_4: { x: 161, y: 456, size: 10 },
  co_5: { x: 161, y: 443, size: 10 },
  total_revised_subcontract: { x: 345, y: 442, size: 10 },

  // Payment Application Summary block
  type_of_work: { x: 150, y: 395, size: 10 },

  // "The payment request which follows covers the time period from [ ] to [ ]"
  period_from: { x: 333, y: 369, size: 10 },
  period_to: { x: 462, y: 369, size: 10 },

  // Middle $ column, numbered lines 4 through 8 (not the DO-NOT-WRITE right col)
  gross_completed_to_date: { x: 360, y: 343, size: 10 },
  previous_billings_to_date: { x: 360, y: 323, size: 10 },
  gross_this_billing: { x: 360, y: 305, size: 10 },
  retention_this_period: { x: 360, y: 285, size: 10 },
  current_payment_due: { x: 360, y: 265, size: 10 },

  // "Total Value of Unapproved Extras or Claims..." line, bottom right
  unapproved_extras_total: { x: 500, y: 248, size: 10 },
};
