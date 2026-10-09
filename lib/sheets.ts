// Server-only spreadsheet access for the finance ledger sync.
//
// Originally Google Sheets (service-account JWT). Swapped to Zoho Sheet,
// which drops the Google Cloud project and service-account key in favour of
// three OAuth client values from the Zoho API console.
//
// Required env vars (set on Vercel):
//   ZOHO_CLIENT_ID       — API console -> your app -> Client ID
//   ZOHO_CLIENT_SECRET   — API console -> your app -> Client Secret
//   ZOHO_REFRESH_TOKEN   — obtained once via the authorization-code flow
//                          (see README, "Zoho Sheet setup")
//   FINANCE_WORKBOOK_ID  — the `resource_id` from the sheet URL
//
// Optional, for non-US Zoho accounts:
//   ZOHO_ACCOUNTS_SERVER — defaults to https://accounts.zoho.com
//   ZOHO_API_DOMAIN      — defaults to https://sheet.zoho.com
//
// The workbook owner must grant this Zoho account edit access so the sync can
// write generated external IDs back into the ID column.
//
// Auth is the OAuth2 refresh-token grant. Zoho has no service-account concept,
// so there is no key file to rotate; access tokens are short-lived and
// refreshed from the long-lived refresh token on demand.

const DEFAULT_ACCOUNTS_SERVER = "https://accounts.zoho.com";
const DEFAULT_API_DOMAIN = "https://sheet.zoho.com";

const SCOPES = "ZohoSheet.dataAPI.READ,ZohoSheet.dataAPI.UPDATE";

// Read this many rows when a caller asks for whole-column ranges. Zoho returns
// only populated cells, so an over-generous bound costs response size, not work.
// A finance ledger will never approach this.
const MAX_SCAN_ROWS = 20_000;

// Zoho workbook ceilings, per the Data API docs. Validated so a typo'd range
// fails loudly instead of being silently clamped server-side.
const MAX_COLUMNS = 2048;
const MAX_ROWS = 262_144;

interface TokenCache {
  access_token: string;
  api_domain: string;
  expires_at: number;
}

/**
 * Zoho's token response carries a generic `api_domain` (www.zohoapis.com for
 * the US data centre), but the Sheet Data API is only served from the region's
 * `sheet.` host. Posting to the generic domain answers 404 "API endpoint not
 * found", so the region is mapped onto the Sheet host instead.
 */
export function sheetApiDomain(tokenApiDomain: string | undefined, fallback: string): string {
  if (!tokenApiDomain) return fallback;
  let host: URL | null = null;
  try {
    host = new URL(tokenApiDomain);
  } catch {
    return fallback;
  }
  // www.zohoapis.com -> zoho.com, then prefix the Sheet host.
  const region = host.hostname
    .replace(/^(www|api)\./, "")
    .replace(/^zohoapis\./, "zoho.");
  return `https://sheet.${region}`;
}

let tokenCache: TokenCache | null = null;

interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsServer: string;
  apiDomain: string;
}

function readConfig(): ZohoConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const workbookId = getFinanceWorkbookId();
  if (!clientId || !clientSecret || !refreshToken || !workbookId) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    accountsServer: process.env.ZOHO_ACCOUNTS_SERVER || DEFAULT_ACCOUNTS_SERVER,
    apiDomain: process.env.ZOHO_API_DOMAIN || DEFAULT_API_DOMAIN,
  };
}

export function getFinanceWorkbookId(): string | null {
  return process.env.FINANCE_WORKBOOK_ID || null;
}

export function isSheetSyncConfigured(): boolean {
  return readConfig() !== null;
}

/** Exchange the refresh token for a short-lived access token. */
export async function getSheetAccessToken(): Promise<{ token: string; apiDomain: string }> {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(
      "Sheet sync is not configured (missing ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN or FINANCE_WORKBOOK_ID).",
    );
  }
  if (tokenCache && tokenCache.expires_at > Date.now() + 60_000) {
    return { token: tokenCache.access_token, apiDomain: tokenCache.api_domain };
  }

  const res = await fetch(`${cfg.accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Zoho token refresh failed (${res.status}). The refresh token may be revoked or expired. ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    api_domain?: string;
  };
  if (!json.access_token) throw new Error("Zoho token refresh returned no access token.");

  tokenCache = {
    access_token: json.access_token,
    api_domain: sheetApiDomain(json.api_domain, cfg.apiDomain),
    expires_at: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000),
  };
  return { token: tokenCache.access_token, apiDomain: tokenCache.api_domain };
}

/** Zoho dispatches every operation as a POST with a `method` form field. */
async function callZoho(
  apiDomain: string,
  token: string,
  workbookId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiDomain}/api/v2/${encodeURIComponent(workbookId)}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho Sheet request failed (${res.status}). ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  // Zoho reports API-level errors inside a 200 body as { code, status, error }.
  const code = json.code;
  if (typeof code === "string" && code.startsWith("2") === false && code !== "200") {
    throw new Error(
      `Zoho Sheet error ${code}: ${String(json.error || json.status || "unknown error")}. ` +
        `If this is 2403 the token lacks ${SCOPES.split(",").join(" and ")}.`,
    );
  }
  return json;
}

// --- A1 notation -> Zoho's 1-based numeric coordinates ---------------------

function columnLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n;
}

interface ParsedRange {
  worksheet: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/** Parse `Expenses!A:H` or `Other Income!A12:A12`. */
export function parseA1Range(range: string): ParsedRange {
  const bang = range.lastIndexOf("!");
  if (bang === -1) throw new Error(`Range must be qualified with a worksheet name: ${range}`);
  const worksheet = range.slice(0, bang).replace(/^'|'$/g, "");
  const ref = range.slice(bang + 1).toUpperCase();
  const m = /^([A-Z]*)(\d*):([A-Z]*)(\d*)$/.exec(ref);
  if (!m) throw new Error(`Unsupported A1 range: ${range}`);
  const [, c1, r1, c2, r2] = m;
  const startColumn = c1 ? columnLettersToNumber(c1) : 1;
  const endColumn = c2 ? columnLettersToNumber(c2) : startColumn;
  const startRow = r1 ? Number(r1) : 1;
  const endRow = r2 ? Number(r2) : MAX_SCAN_ROWS;
  if (startRow > endRow || startColumn > endColumn) {
    throw new Error(`Inverted range: ${range}`);
  }
  if (endColumn > MAX_COLUMNS) {
    throw new Error(`Range ${range} exceeds the ${MAX_COLUMNS}-column workbook limit.`);
  }
  if (endRow > MAX_ROWS) {
    throw new Error(`Range ${range} exceeds the ${MAX_ROWS}-row workbook limit.`);
  }
  return { worksheet, startRow, endRow, startColumn, endColumn };
}

/**
 * Flatten Zoho's sparse range payload into a dense grid.
 *
 * Data API v2 answers `range.content.get` with range_details[].row_details[],
 * each cell carrying an explicit 1-based column_index and only populated cells
 * being present at all. The dense `content` array this used to read is not part
 * of the v2 response, so a sheet full of rows came back empty. Both shapes are
 * accepted so the shape change cannot silently empty the ledger again.
 */
export function flattenRangeContent(json: Record<string, unknown>): string[][] {
  const dense = json.content as unknown[][] | undefined;
  if (Array.isArray(dense)) {
    return dense.map((row) =>
      (row || []).map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object") {
          const rec = cell as { display_value?: unknown; formatted_value?: unknown };
          const v = rec.display_value ?? rec.formatted_value;
          return v === null || v === undefined ? "" : String(v);
        }
        return String(cell);
      }),
    );
  }

  const details = (json.range_details as { row_details?: unknown[] }[] | undefined) || [];
  const rowCount = details.length;
  const width = details.reduce<number>(
    (max, block) =>
      (block.row_details || []).reduce<number>(
        (m, cell) => Math.max(m, Number((cell as { column_index?: number }).column_index) || 0),
        max,
      ),
    0,
  );
  const grid: string[][] = Array.from({ length: rowCount }, () => Array.from({ length: width }, () => ""));
  details.forEach((block, rowOffset) => {
    for (const cell of block.row_details || []) {
      const rec = cell as { column_index?: number; content?: unknown; display_value?: unknown };
      const col = (Number(rec.column_index) || 1) - 1;
      const raw = rec.content ?? rec.display_value;
      const text =
        raw === null || raw === undefined || typeof raw === "object"
          ? ""
          : String(raw);
      if (col >= 0 && col < width) grid[rowOffset][col] = text;
    }
  });
  return grid;
}

/** Read an A1 range. Returns each row as an array of cell strings. */
export async function readSheetRange(workbookId: string, range: string): Promise<string[][]> {
  const cfg = readConfig();
  if (!cfg) throw new Error("Sheet sync is not configured.");
  const { token, apiDomain } = await getSheetAccessToken();
  const p = parseA1Range(range);
  const json = await callZoho(apiDomain, token, workbookId, {
    method: "range.content.get",
    worksheet_name: p.worksheet,
    start_row: String(p.startRow),
    start_column: String(p.startColumn),
    end_row: String(p.endRow),
    end_column: String(p.endColumn),
  });
  // Trim trailing blank rows so the header-mapped parser in finance-sync.ts
  // sees only real data.
  const rows = flattenRangeContent(json);
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
  return rows;
}

/**
 * Write values into an A1 range (used to write generated external IDs back
 * into column A). Cell content is set as literal text, never interpreted as a
 * formula.
 */
export function columnLetter(columnNumber: number): string {
  let n = columnNumber;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function writeSheetRange(
  workbookId: string,
  range: string,
  values: string[][],
): Promise<void> {
  if (values.length === 0) return;
  const cfg = readConfig();
  if (!cfg) throw new Error("Sheet sync is not configured.");
  const { token, apiDomain } = await getSheetAccessToken();
  const p = parseA1Range(range);

  // Zoho's cell.content.set writes one cell per call, so fan out across the
  // rectangle. Write-backs are single cells in practice (column A of one row).
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      await callZoho(apiDomain, token, workbookId, {
        method: "cell.content.set",
        worksheet_name: p.worksheet,
        row: String(p.startRow + r),
        column: String(p.startColumn + c),
        content: values[r][c],
      });
    }
  }
}

// --- Worksheets and sparse cell writes (app → sheet push) -------------------

/** Worksheet names in the workbook, in tab order. */
export async function listWorksheetNames(workbookId: string): Promise<string[]> {
  const cfg = readConfig();
  if (!cfg) throw new Error("Sheet sync is not configured.");
  const { token, apiDomain } = await getSheetAccessToken();
  const json = await callZoho(apiDomain, token, workbookId, { method: "worksheet.list" });
  // Zoho answers worksheet.list with worksheet_names: [{ worksheet_name, worksheet_id }].
  const list =
    (json.worksheet_names as Array<{ worksheet_name?: unknown }> | undefined) ||
    (json.worksheets as Array<{ worksheet_name?: unknown }> | undefined) ||
    [];
  return list.map((w) => String(w.worksheet_name || ""));
}

/** Create the worksheet when missing. Returns true when a tab was added. */
export async function ensureWorksheet(workbookId: string, name: string): Promise<boolean> {
  const names = await listWorksheetNames(workbookId);
  if (names.includes(name)) return false;
  const { token, apiDomain } = await getSheetAccessToken();
  await callZoho(apiDomain, token, workbookId, {
    method: "worksheet.create",
    new_sheet_name: name,
  });
  return true;
}

/**
 * Write only the given cells (1-based coordinates), never a rectangle. The
 * push path fans out one `cell.content.set` per non-empty cell and diffs
 * against the tab first, so an unchanged month costs no writes at all.
 */
export async function setCells(
  workbookId: string,
  worksheet: string,
  cells: Array<{ row: number; col: number; value: string }>,
): Promise<number> {
  if (cells.length === 0) return 0;
  const cfg = readConfig();
  if (!cfg) throw new Error("Sheet sync is not configured.");
  const { token, apiDomain } = await getSheetAccessToken();
  for (const cell of cells) {
    await callZoho(apiDomain, token, workbookId, {
      method: "cell.content.set",
      worksheet_name: worksheet,
      row: String(cell.row),
      column: String(cell.col),
      content: cell.value,
    });
  }
  return cells.length;
}
