// Spreadsheet -> Supabase finance sync.
// Owner keeps the daily ledger in a Zoho Sheet; this turns it into ledger rows.
//
// Sheet layout (each tab must have these headers in row 1, order-insensitive):
//   ID | Date | Title | Category | Amount | Currency | Vendor | Notes
//   - ID: left blank for new rows; the sync generates one and writes it back.
//   - Amount: in major units (e.g. 185 or 185.50), per-row USD or MVR.
//
// Sync policy chosen by the owner (2026-09-28):
//   * Upsert by ID column — same ID updates the row, blank ID inserts new.
//   * Rows removed from the sheet are ARCHIVED (hidden from UI/reports, kept
//     for audit). Re-adding them with the same ID restores.
//   * For rows owned by the sheet the sheet's values win on every sync, so a
//     typo fix or backdate in the sheet is reflected automatically.

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseMajorInput } from "@/lib/money";
import { normalizeExpenseCategory } from "@/lib/expenses";
import {
  columnLetter,
  getFinanceWorkbookId,
  isSheetSyncConfigured,
  readSheetRange,
  writeSheetRange,
} from "@/lib/sheets";

export const EXPENSES_TAB = "Expenses";
export const INCOME_TAB = "Other Income";
export const SHEET_RANGE = "A:H";
/** The tab the app→sheet push writes into — never the ledger tabs the sync reads. */
export const PUSH_TAB = "App Expenses";

export interface SheetFinanceRow {
  externalId: string | null;
  sheetRow: number; // 1-based spreadsheet row (header = 1)
  title: string;
  category: string;
  amountCents: number;
  currency: "USD" | "MVR";
  ledgerDate: string; // YYYY-MM-DD
  vendor: string | null;
  notes: string | null;
}

export type LedgerKind = "expense" | "income";

export interface LedgerLine {
  kind: LedgerKind;
  externalId: string | null;
  sheetRow: number;
  insert: Record<string, unknown>; // DB-writeable object for this ledger type
}

export interface LedgerRowInDb {
  id: string;
  external_id: string | null;
  archived_at: string | null;
}

export interface ReconcileOutcome {
  inserts: number;
  updates: number;
  archives: number;
  restores: number;
  toInsert: Array<{ line: LedgerLine; externalId: string }>;
  toUpdate: Array<{ id: string; patch: Record<string, unknown> }>;
  toArchive: string[];
  writeBacks: Array<{ sheetRow: number; externalId: string }>;
}

/** Form the DB write object for a parsed sheet row + its ledger type. */
export function draftForSheetRow(kind: LedgerKind, row: SheetFinanceRow): Record<string, unknown> {
  const base = {
    title: row.title,
    category: row.category,
    amount_cents: row.amountCents,
    currency: row.currency,
    vendor: row.vendor,
    notes: row.notes,
  };
  return kind === "expense"
    ? { ...base, expense_date: row.ledgerDate }
    : { ...base, income_date: row.ledgerDate };
}

// ================================================================
// Parsing / validation (pure, unit-tested)
// ================================================================

/**
 * Normalize a spreadsheet date cell to YYYY-MM-DD. Falls back to todayISO.
 * Accepts ISO, M/D/YYYY (what Zoho returns as `display_value`) and bare
 * serial day numbers, which some exports emit instead of a formatted string.
 */
export function normalizeSheetDate(cell: string, todayISO: string): string {
  const trim = String(cell || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trim)) return trim;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trim);
  if (mdy) {
    const [, m, d, y] = mdy;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (dt.getUTCFullYear() > 1900) return dt.toISOString().slice(0, 10);
    return todayISO;
  }
  // Serial day number (days since the 1899-12-30 spreadsheet epoch).
  if (/^\d+(\.\d+)?$/.test(trim) && Number(trim) > 10000 && Number(trim) < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + Math.round(Number(trim)) * 86400_000);
    return dt.toISOString().slice(0, 10);
  }
  return todayISO;
}

export function normalizeSheetCurrency(cell: string): "USD" | "MVR" {
  const v = String(cell || "").trim().toUpperCase();
  if (v === "USD" || v === "MVR") return v;
  throw new Error("Currency must be USD or MVR.");
}

/** Parse an Amount cell in major units to cents. */
export function parseSheetAmount(cell: string): number {
  const trimmed = String(cell || "").trim().replace(/,/g, "");
  const cents = parseMajorInput(trimmed);
  if (cents <= 0) throw new Error("Amount must be greater than zero.");
  if (cents > 10_000_000_00) throw new Error("Amount is unrealistically large.");
  return cents;
}

export function parseSheetRows(kind: LedgerKind, values: string[][], todayISO: string): SheetFinanceRow[] {
  const tab = kind === "expense" ? EXPENSES_TAB : INCOME_TAB;
  const headerRow = values[0] || [];
  const headers = new Map<string, number>();
  headerRow.forEach((cell, i) => headers.set(String(cell || "").trim().toLowerCase(), i));

  const has = (name: string) => headers.has(name);
  if (!has("date") || !has("title") || !has("amount")) {
    throw new Error(
      `The "${tab}" tab is missing required headers (Date, Title, Amount).`
    );
  }

  const get = (row: string[], name: string): string => {
    const idx = headers.get(name);
    return idx === undefined ? "" : String(row[idx] ?? "");
  };

  const rows: SheetFinanceRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < values.length; i++) {
    const cells = values[i];
    if (!cells || cells.every((c) => !String(c || "").trim())) continue;
    const sheetRow = i + 1;
    const title = get(cells, "title").trim();
    if (title.length < 2) {
      errors.push(`Row ${sheetRow} in "${tab}" needs a title (at least 2 characters).`);
      continue;
    }
    let amountCents: number;
    let currency: "USD" | "MVR";
    try {
      amountCents = parseSheetAmount(get(cells, "amount"));
      currency = normalizeSheetCurrency(get(cells, "currency"));
    } catch (err) {
      errors.push(`Row ${sheetRow} in "${tab}": ${err instanceof Error ? err.message : "invalid value"}`);
      continue;
    }
    const externalId = get(cells, "id").trim() || null;
    // The ledger only takes the sheet's P&L lines — old names typed in the
    // spreadsheet are mapped the same way migration 086 mapped the DB.
    const category = normalizeExpenseCategory(get(cells, "category"));
    const ledgerDate = normalizeSheetDate(get(cells, "date"), todayISO);
    const vendor = get(cells, "vendor").trim() || null;
    const notes = get(cells, "notes").trim() || null;
    rows.push({ externalId, sheetRow, title, category, amountCents, currency, ledgerDate, vendor, notes });
  }
  if (errors.length) throw new Error(errors.join(" "));
  return rows;
}

// ================================================================
// Reconciliation (pure, unit-tested)
// ================================================================

export function reconcileLedger(
  existing: LedgerRowInDb[],
  lines: LedgerLine[],
  idFactory: () => string
): ReconcileOutcome {
  const outcome: ReconcileOutcome = {
    inserts: 0, updates: 0, archives: 0, restores: 0,
    toInsert: [], toUpdate: [], toArchive: [], writeBacks: [],
  };

  const byExt = new Map<string, LedgerRowInDb>();
  for (const e of existing) if (e.external_id) byExt.set(e.external_id, e);

  const seenIds = new Set<string>();

  for (const line of lines) {
    if (line.externalId) {
      seenIds.add(line.externalId);
      const db = byExt.get(line.externalId);
      if (!db) {
        outcome.inserts += 1;
        outcome.toInsert.push({ line, externalId: line.externalId });
        continue;
      }
      const isArchived = Boolean(db.archived_at);
      const patch = { ...line.insert };
      if (isArchived) {
        outcome.restores += 1;
        patch.archived_at = null;
      } else {
        outcome.updates += 1;
      }
      outcome.toUpdate.push({ id: db.id, patch });
      continue;
    }

    const newId = idFactory();
    outcome.inserts += 1;
    outcome.toInsert.push({ line, externalId: newId });
    outcome.writeBacks.push({ sheetRow: line.sheetRow, externalId: newId });
  }

  for (const e of existing) {
    if (e.external_id && !seenIds.has(e.external_id) && !e.archived_at) {
      outcome.archives += 1;
      outcome.toArchive.push(e.id);
    }
  }

  return outcome;
}

// ================================================================
// Orchestrator
// ================================================================

export function buildLedgerServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface TabSyncSummary {
  inserts: number;
  updates: number;
  archives: number;
  restores: number;
}

export type SyncFinanceResult =
  | { ok: true; expenses: TabSyncSummary; income: TabSyncSummary }
  | { ok: false; reason: string };

export function isConfigured(): "ok" | "missing_env" | "missing_service_key" {
  if (!isSheetSyncConfigured()) return "missing_env";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "missing_service_key";
  return "ok";
}

/**
 * A failed ledger write must never be reported as a successful sync: the sheet
 * gets stamped with its external ID on the way out, so a silently dropped
 * insert leaves the row looking imported while it is missing from the ledger.
 */
export function assertWriteOk(result: { error: unknown } | null, what: string): void {
  const error = result?.error;
  if (!error) return;
  const message =
    typeof error === "object" && error && "message" in error ? String((error as Error).message) : String(error);
  throw new Error(`Could not ${what}: ${message}`);
}

export function newSheetExternalId(): string {
  return `EXT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * 1-based column number of the `Id` header, defaulting to 1 for sheets that
 * omit the column entirely.
 */
export function idHeaderColumn(headerRow: string[]): number {
  const idx = headerRow.findIndex((cell) => cell.trim().toLowerCase() === "id");
  return idx === -1 ? 1 : idx + 1;
}

export async function syncFinanceSheets(
  db: SupabaseClient | null = null,
  todayISO: string = new Date().toISOString().slice(0, 10)
): Promise<SyncFinanceResult> {
  const cfg = isConfigured();
  if (cfg !== "ok") return { ok: false, reason: cfg };

  const client = db || buildLedgerServiceClient();
  if (!client) return { ok: false, reason: "missing_service_key" };

  const workbookId = getFinanceWorkbookId()!;

  const results: Record<LedgerKind, TabSyncSummary> = {
    expense: { inserts: 0, updates: 0, archives: 0, restores: 0 },
    income: { inserts: 0, updates: 0, archives: 0, restores: 0 },
  };

  try {
    for (const kind of ["expense", "income"] as const) {
      const tab = kind === "expense" ? EXPENSES_TAB : INCOME_TAB;
      const table = kind === "expense" ? "expenses" : "other_income";

      const values = await readSheetRange(workbookId, `${tab}!${SHEET_RANGE}`);
      const rows = parseSheetRows(kind, values, todayISO);
      // Generated IDs are stamped back into the sheet so the next sync matches
      // rows instead of re-importing them. That must land in the `Id` column
      // the parser read from -- always writing to column A used to overwrite
      // the Date when Id sat anywhere else, silently destroying the date.
      const idColumn = idHeaderColumn(values[0] || []);
      const lines: LedgerLine[] = rows.map((r) => ({
        kind,
        externalId: r.externalId,
        sheetRow: r.sheetRow,
        insert: draftForSheetRow(kind, r),
      }));

      const { data: existingRows, error: readError } = await client
        .from(table)
        .select("id, external_id, archived_at");
      // A failed read would leave `existing` empty and make every sheet row look
      // new, importing the whole ledger a second time. Abort instead.
      assertWriteOk({ error: readError }, `read current "${tab}" rows`);
      const existing: LedgerRowInDb[] = ((existingRows || []) as unknown[]).map((r) => {
        const row = r as { id: string; external_id: string | null; archived_at: string | null };
        return { id: row.id, external_id: row.external_id, archived_at: row.archived_at };
      });

      const outcome = reconcileLedger(existing, lines, newSheetExternalId);
      const now = new Date().toISOString();

      for (const ins of outcome.toInsert) {
        assertWriteOk(
          await client.from(table).insert({ ...ins.line.insert, external_id: ins.externalId }),
          `import "${tab}" row ${ins.line.sheetRow}`,
        );
      }
      for (const up of outcome.toUpdate) {
        assertWriteOk(await client.from(table).update(up.patch).eq("id", up.id), `update "${tab}" row`);
      }
      if (outcome.toArchive.length > 0) {
        assertWriteOk(
          await client.from(table).update({ archived_at: now }).in("id", outcome.toArchive),
          `archive "${tab}" rows`,
        );
      }
      for (const wb of outcome.writeBacks) {
        const col = columnLetter(idColumn);
        await writeSheetRange(workbookId, `${tab}!${col}${wb.sheetRow}:${col}${wb.sheetRow}`, [
          [wb.externalId],
        ]);
      }

      results[kind] = {
        inserts: outcome.inserts,
        updates: outcome.updates,
        archives: outcome.archives,
        restores: outcome.restores,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error.";
    return { ok: false, reason: message };
  }

  return { ok: true, expenses: results.expense, income: results.income };
}