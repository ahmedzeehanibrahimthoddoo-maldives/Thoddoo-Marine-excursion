import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseA1Range } from "../lib/sheets";

describe("zoho sheet adapter — A1 range parsing", () => {
  it("parses a whole-column range with a multi-word worksheet name", () => {
    const p = parseA1Range("Other Income!A:H");
    assert.equal(p.worksheet, "Other Income");
    assert.equal(p.startColumn, 1);
    assert.equal(p.endColumn, 8);
    assert.equal(p.startRow, 1);
    assert.ok(p.endRow > 1, "whole-column range must scan downward");
  });

  it("parses a single cell, the shape used to write external IDs back", () => {
    const p = parseA1Range("Expenses!A12:A12");
    assert.equal(p.worksheet, "Expenses");
    assert.equal(p.startRow, 12);
    assert.equal(p.endRow, 12);
    assert.equal(p.startColumn, 1);
    assert.equal(p.endColumn, 1);
  });

  it("is case insensitive on the cell reference", () => {
    assert.deepEqual(parseA1Range("Expenses!a3:b4"), parseA1Range("Expenses!A3:B4"));
  });

  it("converts multi-letter columns", () => {
    assert.equal(parseA1Range("Expenses!A:AA").endColumn, 27);
    assert.equal(parseA1Range("Expenses!A:Z").endColumn, 26);
  });

  it("strips quotes around worksheet names", () => {
    assert.equal(parseA1Range("'Other Income'!A:H").worksheet, "Other Income");
  });

  it("rejects a range with no worksheet, which would silently read the wrong tab", () => {
    assert.throws(() => parseA1Range("A:H"), /worksheet name/);
  });

  it("rejects an inverted range", () => {
    assert.throws(() => parseA1Range("Expenses!A9:A2"), /Inverted/);
    assert.throws(() => parseA1Range("Expenses!C2:B2"), /Inverted/);
  });

  it("rejects malformed references instead of guessing", () => {
    assert.throws(() => parseA1Range("Expenses!??:B2"), /Unsupported A1 range/);
    assert.throws(() => parseA1Range("Expenses!A1:B2:C3"), /Unsupported A1 range/);
  });

  it("rejects a range past the workbook column ceiling", () => {
    // ZZZZ is column 18278, far past the 2048-column limit; Zoho would clamp
    // or reject server-side, so catch it here instead.
    assert.throws(() => parseA1Range("Expenses!A1:ZZZZ"), /column workbook limit/);
  });
});

describe("zoho sheet adapter — no google coupling remains", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, "..", rel), "utf-8");

  it("lib/gsheets.ts is gone", () => {
    assert.equal(
      fs.existsSync(path.resolve(__dirname, "../lib/gsheets.ts")),
      false,
      "the Google service-account adapter should be deleted, not left alongside",
    );
  });

  it("reads Zoho OAuth env vars, not a Google service account key", () => {
    const sheets = read("lib/sheets.ts");
    assert.match(sheets, /ZOHO_CLIENT_ID/);
    assert.match(sheets, /ZOHO_CLIENT_SECRET/);
    assert.match(sheets, /ZOHO_REFRESH_TOKEN/);
    assert.match(sheets, /FINANCE_WORKBOOK_ID/);
    assert.doesNotMatch(sheets, /GOOGLE_SERVICE_ACCOUNT/);
    assert.doesNotMatch(sheets, /FINANCE_SHEET_ID/);
  });

  it("refreshes the access token instead of signing a service-account JWT", () => {
    const sheets = read("lib/sheets.ts");
    assert.match(sheets, /grant_type["']?:\s*["']refresh_token/);
    assert.match(sheets, /accounts\.zoho\.com|DEFAULT_ACCOUNTS_SERVER/);
    assert.doesNotMatch(sheets, /createSign|RSA-SHA256|jwt-bearer/i);
  });

  it("sends the Zoho-oauthtoken authorization scheme", () => {
    assert.match(read("lib/sheets.ts"), /Zoho-oauthtoken/);
  });

  it("requests both read and update scopes, since IDs are written back", () => {
    const sheets = read("lib/sheets.ts");
    assert.match(sheets, /ZohoSheet\.dataAPI\.READ/);
    assert.match(sheets, /ZohoSheet\.dataAPI\.UPDATE/);
  });

  it("surfaces Zoho in-body API errors instead of treating a 200 as success", () => {
    const sheets = read("lib/sheets.ts");
    assert.match(sheets, /json\.code/);
    assert.match(sheets, /Zoho Sheet error/);
  });

  it("trims trailing blank rows so the header parser sees only real data", () => {
    assert.match(
      read("lib/sheets.ts"),
      /rows\[rows\.length - 1\]\.every\(\(cell\) => cell === ""\)/,
    );
  });

  it("finance-sync.ts wires the Zoho adapter", () => {
    const sync = read("lib/finance-sync.ts");
    assert.match(sync, /from "@\/lib\/sheets"/);
    assert.match(sync, /getFinanceWorkbookId/);
    assert.match(sync, /isSheetSyncConfigured/);
    assert.doesNotMatch(sync, /gsheets|isGoogleSyncConfigured|getFinanceSheetId/);
  });

  it("no source file still refers to a Google service account", () => {
    for (const rel of [
      "lib/finance-sync.ts",
      "lib/sheets.ts",
      "lib/supabase/actions.ts",
      "app/admin/components/FinanceSyncButton.tsx",
      "app/admin/income/IncomePageClient.tsx",
      "app/api/sync/finance/route.ts",
    ]) {
      assert.doesNotMatch(
        read(rel),
        /GOOGLE_SERVICE_ACCOUNT|FINANCE_SHEET_ID|lib\/gsheets/,
        `${rel} still references Google Sheets`,
      );
    }
  });

  it("admin UI copy names Zoho, not Google", () => {
    assert.match(read("app/admin/components/FinanceSyncButton.tsx"), /Sync Zoho Sheet/);
    assert.doesNotMatch(read("app/admin/components/FinanceSyncButton.tsx"), /Google/);
    assert.doesNotMatch(read("app/admin/income/IncomePageClient.tsx"), /Google/);
  });
});
