// =============================================
// Thoddoo Marine — Expenses: the monthly sheet, as data
// =============================================
// The books are kept on a monthly grid (Date | Detail | Liter petrol |
// Rate | Petrol | Engine Oil | Sparking Plug | Oil Filter | Hire
// Equipment | Other Services | Asset_Small | Electricity | Salary |
// Commission) that rolls up into the P&L lines. This file is that sheet
// as pure data + parsers, shared by the grid entry, the paste/CSV import
// and the tests — no Supabase, no React.
//
// Every grid cell becomes its own expense row, keyed by
// `entry_key = YYYY-MM-DD:column` so re-saving a month upserts.
// =============================================

/** The P&L lines the sheet rolls into — the only category names we write. */
export const EXPENSE_CATEGORIES = [
  "Fuel",
  "Salary",
  "Repair & Maintenance",
  "Hire Equipment",
  "Commissions",
  "Electricity",
  "Asset-Small",
  "Other Services",
  "Other",
] as const;

/** Older category names, mapped the same way migration 086 does in SQL. */
const CATEGORY_ALIASES: Record<string, string> = {
  "boat fuel": "Fuel",
  "fuel": "Fuel",
  "petrol": "Fuel",
  "maintenance": "Repair & Maintenance",
  "repair & maintance": "Repair & Maintenance",
  "repairs": "Repair & Maintenance",
  "equipment": "Hire Equipment",
  "hire equipment": "Hire Equipment",
  "commission": "Commissions",
  "commissions": "Commissions",
  "crew": "Salary",
  "salaries": "Salary",
  "staff": "Salary",
  "transfers": "Other Services",
  "services": "Other Services",
  "electricity": "Electricity",
  "asset_small": "Asset-Small",
  "asset small": "Asset-Small",
  "asset-small": "Asset-Small",
  "other services": "Other Services",
  "fees": "Other",
  "supplies": "Other",
  "water": "Other",
  "other": "Other",
};

export function normalizeExpenseCategory(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "Other";
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  return CATEGORY_ALIASES[s.toLowerCase()] || "Other";
}

export interface ExpenseGridColumn {
  /** entry_key suffix and the form's field name. */
  key: string;
  /** The sheet's column header. */
  label: string;
  /** The P&L line this column rolls into. */
  category: string;
  /** Petrol: the cell may come from litres × rate instead of a typed amount. */
  fuel?: boolean;
}

/** The sheet's money columns, left to right. */
export const EXPENSE_GRID_COLUMNS: ExpenseGridColumn[] = [
  { key: "petrol", label: "Petrol", category: "Fuel", fuel: true },
  { key: "engine_oil", label: "Engine Oil", category: "Repair & Maintenance" },
  { key: "spark_plug", label: "Sparking Plug", category: "Repair & Maintenance" },
  { key: "oil_filter", label: "Oil Filter", category: "Repair & Maintenance" },
  { key: "hire_equipment", label: "Hire Equipment", category: "Hire Equipment" },
  { key: "other_services", label: "Other Services", category: "Other Services" },
  { key: "asset_small", label: "Asset_Small", category: "Asset-Small" },
  { key: "electricity", label: "Electricity", category: "Electricity" },
  { key: "salary", label: "Salary", category: "Salary" },
  { key: "commission", label: "Commission", category: "Commissions" },
];

/** One expense row standing for one grid cell. */
export interface ExpenseDraft {
  entry_key: string;
  expense_date: string;
  title: string;
  category: string;
  amount_cents: number;
  currency: "USD" | "MVR";
  notes: string | null;
}

export function expenseEntryKey(date: string, columnKey: string): string {
  return `${date}:${columnKey}`;
}

/**
 * One grid cell → the expense row it stands for, or null when the cell is
 * empty. Petrol prefers its own amount and falls back to litres × rate, the
 * way the sheet computes it.
 */
export function gridCellExpense(opts: {
  date: string;
  column: ExpenseGridColumn;
  /** The cell's own amount, in major units. */
  amount?: number | null;
  detail?: string | null;
  litres?: number | null;
  rate?: number | null;
  currency?: "USD" | "MVR";
}): ExpenseDraft | null {
  const cents = Math.round(Number(opts.amount || 0) * 100);
  const fuelCents =
    opts.column.fuel && cents <= 0 && Number(opts.litres) > 0 && Number(opts.rate) > 0
      ? Math.round(Number(opts.litres) * Number(opts.rate) * 100)
      : 0;
  const total = Math.max(cents, fuelCents);
  if (total <= 0) return null;

  const detail = String(opts.detail || "").trim();
  const notes: string[] = [];
  if (opts.column.fuel && Number(opts.litres) > 0 && Number(opts.rate) > 0) {
    notes.push(`${opts.litres} L × ${opts.rate} MVR/L`);
  }
  if (detail && detail.toLowerCase() !== opts.column.label.toLowerCase()) notes.push(detail);

  return {
    entry_key: expenseEntryKey(opts.date, opts.column.key),
    expense_date: opts.date,
    title: detail || opts.column.label,
    category: opts.column.category,
    amount_cents: total,
    currency: opts.currency === "USD" ? "USD" : "MVR",
    notes: notes.length ? notes.join(" · ") : null,
  };
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** Days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const m = MONTH_RE.exec(String(month || ""));
  if (!m) return 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** Every date in a `YYYY-MM` month, for the grid's rows. */
export function monthDates(month: string): string[] {
  const n = daysInMonth(month);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
  return out;
}

/** The month after `YYYY-MM`, as a date string (for range queries). */
export function nextMonthStart(month: string): string {
  const m = MONTH_RE.exec(String(month || ""));
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
}

// =============================================
// Paste / CSV import
// =============================================

export interface ExpenseImportRow {
  expense_date: string;
  title: string;
  category: string;
  amount_cents: number;
  currency: "USD" | "MVR";
  vendor?: string | null;
  notes?: string | null;
}

export interface ExpenseImportResult {
  rows: ExpenseImportRow[];
  errors: string[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Dates arrive as the books write them: 2023-11-10, 10/11/2023 (day first,
 * Maldives style) or the odd "10/11/2023.." with trailing dots. Anything
 * else is refused rather than guessed.
 */
export function parseImportDate(raw: string | null | undefined): string | null {
  const s = String(raw || "").trim().replace(/\.+$/g, "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return isoDate(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** "1,234.50", "17.31", "MVR 700" → 1234.5 / 17.31 / 700. */
export function parseMajorAmount(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").replace(/[^0-9.\-]/g, "");
  if (!s || s === "." || s === "-") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Column layout of the monthly expense sheet, by header or position. */
const SHEET_LAYOUT: Array<{ key: string; hints: string[] }> = [
  { key: "petrol", hints: ["petrol", "fuel"] },
  { key: "engine_oil", hints: ["engine oil"] },
  { key: "spark_plug", hints: ["sparking plug", "spark plug"] },
  { key: "oil_filter", hints: ["oil filter"] },
  { key: "hire_equipment", hints: ["hire equipment"] },
  { key: "other_services", hints: ["other services"] },
  { key: "asset_small", hints: ["asset small", "asset"] },
  { key: "electricity", hints: ["electricity"] },
  { key: "salary", hints: ["salary", "salaries"] },
  { key: "commission", hints: ["commissions", "commission"] },
];

/** The sheet's positional order, for headerless pastes. */
const SHEET_POSITION: Record<string, number> = {
  date: 0,
  detail: 1,
  litres: 2,
  rate: 3,
  petrol: 4,
  engine_oil: 5,
  spark_plug: 6,
  oil_filter: 7,
  hire_equipment: 8,
  other_services: 9,
  asset_small: 10,
  electricity: 11,
  salary: 12,
  commission: 13,
};

/**
 * Parse a paste (tab-separated, straight from Excel) or a CSV export.
 *
 * Two shapes are understood:
 *   * the monthly sheet — Date, Detail, Liter petrol, Rate and the money
 *     columns; one line can produce several expenses, blank dates carry
 *     down from the line above, exactly as the sheet reads;
 *   * a plain ledger — date, title, category, amount, currency, vendor,
 *     notes.
 */
export function parseExpenseImport(text: string): ExpenseImportResult {
  const errors: string[] = [];
  const rows: ExpenseImportRow[] = [];
  // Leading tabs ARE the column positions — only strip the line break, never
  // the padding (a trim() here would slide every money cell left).
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows, errors: ["Nothing to import."] };

  const head = splitLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim()
  );
  const findCol = (hints: string[]): number =>
    head.findIndex((h) => hints.some((x) => h === x || h.startsWith(x)));

  const dateIdx = findCol(["date"]);
  const detailIdx = findCol(["detail", "description", "item"]);
  const litresIdx = findCol(["liter petrol", "litre petrol", "litres", "liters", "liter"]);
  const rateIdx = findCol(["rate"]);
  const moneyIdx = new Map<string, number>();
  for (const c of SHEET_LAYOUT) {
    const i = findCol(c.hints);
    if (i >= 0) moneyIdx.set(c.key, i);
  }
  const isSheet = dateIdx >= 0 && (moneyIdx.has("petrol") || moneyIdx.has("engine_oil")) && (rateIdx >= 0 || moneyIdx.size >= 3);

  const titleIdx = findCol(["title", "description", "detail", "item"]);
  const categoryIdx = findCol(["category"]);
  const amountIdx = findCol(["amount", "value", "total"]);
  const currencyIdx = findCol(["currency"]);
  const vendorIdx = findCol(["vendor"]);
  const notesIdx = findCol(["notes", "note"]);
  const hasSimpleHeader = dateIdx >= 0 && (titleIdx >= 0 || amountIdx >= 0);
  const positionalSheet = dateIdx < 0 && parseImportDate(splitLine(lines[0])[0] ?? "") !== null && splitLine(lines[0]).length >= 9;

  const pushRow = (row: ExpenseImportRow | null) => {
    if (row) rows.push(row);
  };

  if (isSheet || positionalSheet) {
    const idxOf = (key: string): number => {
      if (positionalSheet && dateIdx < 0) return SHEET_POSITION[key] ?? -1;
      if (key === "date") return dateIdx;
      if (key === "detail") return detailIdx;
      if (key === "litres") return litresIdx;
      if (key === "rate") return rateIdx;
      return moneyIdx.get(key) ?? -1;
    };
    let lastDate = "";
    for (let i = positionalSheet ? 0 : 1; i < lines.length; i++) {
      const cells = splitLine(lines[i]);
      const parsed = parseImportDate(cells[idxOf("date")] ?? "");
      if (parsed) lastDate = parsed;
      const date = parsed || lastDate;
      if (!date) {
        errors.push(`Row ${i + 1}: no date (and none above it) — skipped.`);
        continue;
      }
      const detail = (cells[idxOf("detail")] ?? "").trim();
      const litres = parseMajorAmount(cells[idxOf("litres")] ?? null);
      const rate = parseMajorAmount(cells[idxOf("rate")] ?? null);
      for (const col of EXPENSE_GRID_COLUMNS) {
        const ci = idxOf(col.key);
        if (ci < 0 || ci >= cells.length) continue;
        const draft = gridCellExpense({
          date,
          column: col,
          amount: parseMajorAmount(cells[ci] ?? null),
          detail,
          litres: litres || null,
          rate: rate || null,
        });
        if (draft) {
          pushRow({
            expense_date: draft.expense_date,
            title: draft.title,
            category: draft.category,
            amount_cents: draft.amount_cents,
            currency: draft.currency,
            notes: draft.notes,
          });
        }
      }
      // A blank day in the sheet is normal — not an error.
    }
    return { rows, errors };
  }

  if (!hasSimpleHeader) {
    errors.push("No header row recognised — expected the sheet's 'Date | Detail | Liter petrol | Rate | …' or 'date | title | category | amount | currency'.");
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const n = i + 1;
    const date = parseImportDate(cells[dateIdx] ?? "");
    if (!date) {
      errors.push(`Row ${n}: unreadable date "${cells[dateIdx] ?? ""}" — skipped.`);
      continue;
    }
    const title = (cells[titleIdx] ?? "").trim();
    if (!title) {
      errors.push(`Row ${n}: missing title — skipped.`);
      continue;
    }
    const amount = parseMajorAmount(cells[amountIdx] ?? null);
    if (amount <= 0) {
      errors.push(`Row ${n}: amount must be above zero — skipped.`);
      continue;
    }
    const cur = (cells[currencyIdx] ?? "").trim().toUpperCase();
    const currency: "USD" | "MVR" = cur === "USD" ? "USD" : "MVR";
    pushRow({
      expense_date: date,
      title,
      category: normalizeExpenseCategory(cells[categoryIdx] ?? ""),
      amount_cents: Math.round(amount * 100),
      currency,
      vendor: (cells[vendorIdx] ?? "").trim() || null,
      notes: (cells[notesIdx] ?? "").trim() || null,
    });
  }
  return { rows, errors };
}

// =============================================
// App → Zoho: the sheet view of our expenses
// =============================================

/** The accountant's exact 14-column header, left to right. */
export const ZOHO_GRID_HEADERS = [
  "Date",
  "Detail",
  "Liter petrol",
  "Rate",
  "Petrol",
  "Engine Oil",
  "Sparking Plug",
  "Oil Filter",
  "Hire Equipment",
  "Other Services",
  "Asset_Small",
  "Electricity",
  "SALARY",
  "Commission",
] as const;

/** 1-based sheet column for each grid key (Date=1, Detail=2). */
const GRID_KEY_SHEET_COLUMN: Record<string, number> = {
  petrol: 5,
  engine_oil: 6,
  spark_plug: 7,
  oil_filter: 8,
  hire_equipment: 9,
  other_services: 10,
  asset_small: 11,
  electricity: 12,
  salary: 13,
  commission: 14,
};

/** Hand-entered rows (no entry_key) fall into this column by category. */
const CATEGORY_FALLBACK_COLUMN: Record<string, string> = {
  Fuel: "petrol",
  Salary: "salary",
  Electricity: "electricity",
  "Hire Equipment": "hire_equipment",
  Commissions: "commission",
  "Asset-Small": "asset_small",
  "Other Services": "other_services",
  "Repair & Maintenance": "other_services",
  Other: "other_services",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `123 L × 45.5 MVR/L`, as written back into the notes by gridCellExpense. */
const FUEL_NOTES_RE = /([0-9]+(?:\.[0-9]+)?) L × ([0-9]+(?:\.[0-9]+)?) MVR\/L/;

function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export interface ZohoGridExpense {
  expense_date: string;
  title?: string | null;
  category?: string | null;
  amount_cents?: number | null;
  entry_key?: string | null;
  notes?: string | null;
  currency?: string | null;
}

export interface ZohoGridCell {
  /** 1-based sheet coordinates. */
  row: number;
  col: number;
  value: string;
}

export interface ZohoGrid {
  /** Dense rows, header first, `""` for empty cells. */
  values: string[][];
  /** Every non-empty cell, for sparse writes and diffing against the tab. */
  nonEmpty: ZohoGridCell[];
}

/**
 * Rebuild the accountant's monthly sheet from our expense rows — the view the
 * "Push to Zoho" writes into the workbook. Every expense becomes one row,
 * date-sorted; grid rows (entry_key) land in their exact column, hand-entered
 * rows fall back by category, and each month is followed by a column-totals
 * row the way the book keeps it. Months stack into one grid, blank line apart.
 */
export function buildZohoMonthlyGrid(expenses: ZohoGridExpense[]): ZohoGrid {
  const rows = (expenses || [])
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(String(e?.expense_date || "")) && Number(e?.amount_cents) > 0)
    .slice()
    .sort(
      (a, b) =>
        String(a.expense_date).localeCompare(String(b.expense_date)) ||
        String(a.title || "").localeCompare(String(b.title || "")),
    );

  const values: string[][] = [[...ZOHO_GRID_HEADERS]];
  const width = ZOHO_GRID_HEADERS.length;

  let month = "";
  // Column sums in cents (money) and litre-cents (petrol litres), scaled x100.
  let colSums = new Array<number>(width).fill(0);

  const flushMonth = () => {
    if (!month) return;
    const [y, mo] = month.split("-").map(Number);
    const totalRow = new Array<string>(width).fill("");
    totalRow[1] = `Total ${MONTH_NAMES[mo - 1]} ${y}`;
    for (let c = 2; c < width; c++) {
      if (c === 3) continue; // a sum of rates is meaningless
      if (colSums[c] > 0) totalRow[c] = money(colSums[c]);
    }
    values.push(totalRow);
    month = "";
    colSums = new Array<number>(width).fill(0);
  };

  for (const e of rows) {
    const date = String(e.expense_date);
    const monthKey = date.slice(0, 7);
    if (monthKey !== month) {
      if (month) {
        flushMonth();
        values.push(new Array<string>(width).fill(""));
      }
      month = monthKey;
      colSums = new Array<number>(width).fill(0);
    }

    const cents = Number(e.amount_cents);
    const title = String(e.title || "").trim();
    const key = String(e.entry_key || "");
    const colon = key.indexOf(":");
    const colKey = colon > 0 ? key.slice(colon + 1) : "";

    const row = new Array<string>(width).fill("");
    row[0] = date;

    if (colKey in GRID_KEY_SHEET_COLUMN) {
      const c = GRID_KEY_SHEET_COLUMN[colKey] - 1;
      row[1] = title || EXPENSE_GRID_COLUMNS.find((g) => g.key === colKey)?.label || colKey;
      row[c] = money(cents);
      colSums[c] += cents;
      if (colKey === "petrol") {
        const m = FUEL_NOTES_RE.exec(String(e.notes || ""));
        if (m) {
          row[2] = m[1];
          row[3] = m[2];
          colSums[2] += Math.round(Number(m[1]) * 100);
        }
      }
    } else {
      const category = normalizeExpenseCategory(e.category);
      const fallbackKey = CATEGORY_FALLBACK_COLUMN[category] || "other_services";
      const c = GRID_KEY_SHEET_COLUMN[fallbackKey] - 1;
      const columnCategory = EXPENSE_GRID_COLUMNS.find((g) => g.key === fallbackKey)?.category;
      const detail = title || category;
      // Keep the P&L line visible when it differs from the column it lands in.
      row[1] = columnCategory && category !== columnCategory ? `${detail} (${category})` : detail;
      row[c] = money(cents);
      colSums[c] += cents;
    }
    if (String(e.currency || "").toUpperCase() === "USD") row[1] = `${row[1]} (USD)`;
    values.push(row);
  }
  flushMonth();

  const nonEmpty: ZohoGridCell[] = [];
  values.forEach((r, i) =>
    r.forEach((v, j) => {
      if (v !== "") nonEmpty.push({ row: i + 1, col: j + 1, value: v });
    }),
  );
  return { values, nonEmpty };
}
