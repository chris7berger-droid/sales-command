// Daily follow-up reminders.
//
// The call log has carried a follow-up date since day one, and the New Inquiry
// wizard has always told the user "a reminder will be sent to the sales rep" —
// but nothing ever read that date except the colour of a cell on the Call Log
// list. This is the job that makes the promise true.
//
// Shape: one DIGEST email per rep per run, listing every job of theirs whose
// follow-up has come due. Not one email per job — a rep with six follow-ups on
// a Monday should get one useful list, not six pings.
//
// SELF-HEALING: a row is picked up when `follow_up_reminded_for` doesn't equal
// its current `follow_up`, and stamped once the digest goes out. So a night the
// job doesn't run doesn't silently lose that day's reminders — they go out the
// next run — and pushing a follow-up date out re-arms it. That matters here:
// the project's other nightly job failed every night from June 9 unnoticed
// because nothing about it was observable or catch-up capable.
//
// SECURITY: this is a cron target with no human caller. It is deployed
// --no-verify-jwt, so the x-cron-secret shared secret is the ONLY gate.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";
import { emailShell, sendEmail, SITE_URL } from "../_shared/repNotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const TZ = "America/Los_Angeles";
const CLOSED_STAGES = ["Sold", "Lost"];
const enc = new TextEncoder();

/** Today in the company's timezone, as YYYY-MM-DD. The DB stores follow_up as a
 *  bare date, so comparing against a UTC "today" would fire a day early every
 *  evening after 4/5pm Pacific. */
function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Length is checked first: std timingSafeEqual throws on unequal-length views.
  const a = enc.encode(req.headers.get("x-cron-secret") || "");
  const b = enc.encode(CRON_SECRET || "");
  if (!CRON_SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Forbidden", { status: 403 });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status,
    });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const today = todayLocal();

    // Candidates: due (or overdue) and still open. `follow_up_reminded_for` is
    // compared in JS because PostgREST can't express a column-to-column
    // "is distinct from". Paged because PostgREST caps a response at 1000 rows.
    const due: any[] = [];
    const PAGE = 500;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("call_log")
        .select("id, tenant_id, job_name, display_job_number, customer_name, stage, sales_name, follow_up, follow_up_reminded_for")
        .not("follow_up", "is", null)
        .lte("follow_up", today)
        .not("stage", "in", `(${CLOSED_STAGES.join(",")})`)
        .order("follow_up", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error("follow-up-reminders: query failed —", error.message);
        return json(500, { error: error.message });
      }
      const rows = data || [];
      due.push(...rows.filter((r) => r.follow_up_reminded_for !== r.follow_up));
      if (rows.length < PAGE) break;
    }

    if (due.length === 0) {
      console.log(`follow-up-reminders: nothing due as of ${today}`);
      return json(200, { date: today, due: 0, emails: 0 });
    }

    // Active team members, keyed by trimmed lowercase name. call_log.sales_name
    // is free text and at least one prod team_members row has a trailing space
    // ("John Paul "), so an exact `=` join drops matches.
    const { data: members } = await sb
      .from("team_members")
      .select("name, email, tenant_id, active")
      .eq("active", true);

    const repByKey = new Map<string, { name: string; email: string }>();
    for (const m of members || []) {
      const key = `${m.tenant_id}::${(m.name || "").trim().toLowerCase()}`;
      if (m.email) repByKey.set(key, { name: (m.name || "").trim(), email: m.email });
    }

    // Group due jobs by rep.
    const groups = new Map<string, { rep: { name: string; email: string }; rows: any[] }>();
    const unassigned: any[] = [];
    for (const row of due) {
      const key = `${row.tenant_id}::${(row.sales_name || "").trim().toLowerCase()}`;
      const rep = (row.sales_name || "").trim() ? repByKey.get(key) : undefined;
      if (!rep) { unassigned.push(row); continue; }
      if (!groups.has(key)) groups.set(key, { rep, rows: [] });
      groups.get(key)!.rows.push(row);
    }

    if (unassigned.length) {
      console.error(
        `follow-up-reminders: ${unassigned.length} due follow-up(s) have no active rep with an email — ` +
        unassigned.map((r) => `${r.display_job_number || r.id}:"${r.sales_name ?? ""}"`).join(", "),
      );
    }

    let emails = 0;
    const stampedIds: number[] = [];

    for (const { rep, rows } of groups.values()) {
      const items = rows.map((r) => {
        const overdue = r.follow_up < today;
        const label = esc(r.job_name || r.display_job_number || "Untitled job");
        return `
          <tr>
            <td style="padding: 8px 12px 8px 0; border-bottom: 1px solid #e6e0d8; vertical-align: top;">
              <a href="${SITE_URL}/calllog/${r.id}" style="color: #0f766e; font-weight: bold; text-decoration: none;">${label}</a>
              <div style="color: #4a4238; font-size: 13px;">${esc(r.customer_name || "")}</div>
            </td>
            <td style="padding: 8px 0; border-bottom: 1px solid #e6e0d8; vertical-align: top; white-space: nowrap; text-align: right;">
              <div style="font-size: 13px; color: ${overdue ? "#b91c1c" : "#1c1814"};">
                ${fmtDate(r.follow_up)}${overdue ? " (overdue)" : ""}
              </div>
              <div style="font-size: 12px; color: #887c6e;">${esc(r.stage || "")}</div>
            </td>
          </tr>`;
      }).join("");

      const n = rows.length;
      const html = emailShell(`
        <p>Hi ${esc(rep.name)},</p>
        <p>You have <strong>${n} follow-up${n === 1 ? "" : "s"}</strong> due:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${items}</table>
        <p style="font-size: 13px; color: #4a4238;">
          Change or clear a follow-up date on the job's page in
          <a href="${SITE_URL}/calllog" style="color: #0f766e;">Sales Command</a>.
        </p>
      `);

      const subject = n === 1
        ? `Follow-up due — ${rows[0].job_name || rows[0].display_job_number || "job"}`
        : `${n} follow-ups due`;

      const result = await sendEmail(rep.email, subject, html, "follow-up-reminders");
      if (result.sent) {
        emails += 1;
        // Only stamp what actually got delivered, so a failed send retries on
        // the next run instead of being silently marked done.
        stampedIds.push(...rows.map((r) => r.id));
      }
    }

    for (const row of due) {
      if (!stampedIds.includes(row.id)) continue;
      const { error: stampErr } = await sb
        .from("call_log")
        .update({ follow_up_reminded_for: row.follow_up })
        .eq("id", row.id);
      if (stampErr) console.error(`follow-up-reminders: stamp failed for ${row.id} — ${stampErr.message}`);
    }

    console.log(`follow-up-reminders: ${today} — ${due.length} due, ${emails} email(s), ${unassigned.length} unassigned`);
    return json(200, { date: today, due: due.length, emails, unassigned: unassigned.length });
  } catch (error) {
    console.error("follow-up-reminders error:", (error as Error).message);
    return json(500, { error: (error as Error).message });
  }
});
