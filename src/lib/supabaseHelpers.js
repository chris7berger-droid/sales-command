import { supabase } from "./supabase";

/**
 * Fetch all rows from a table, paginating past PostgREST's 1000-row limit.
 * @param {string} table - Table name
 * @param {string} select - Select string (e.g. "*" or "id, name")
 * @param {object} opts - { order, filters, pageSize }
 *   order: { column, ascending } or just column string
 *   filters: array of [method, ...args] e.g. [["eq", "active", true]]
 */
export async function fetchAll(table, select = "*", opts = {}) {
  const { order, filters = [], pageSize = 1000 } = opts;
  let all = [], from = 0;
  while (true) {
    let q = supabase.from(table).select(select);
    if (order) {
      const col = typeof order === "string" ? order : order.column;
      const asc = typeof order === "string" ? true : order.ascending;
      q = q.order(col, { ascending: asc !== false });
    }
    for (const [method, ...args] of filters) {
      q = q[method](...args);
    }
    const { data } = await q.range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
