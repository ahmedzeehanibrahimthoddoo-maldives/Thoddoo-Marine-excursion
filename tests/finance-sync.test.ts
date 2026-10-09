import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSheetRows, reconcileLedger, draftForSheetRow,
  normalizeSheetDate, normalizeSheetCurrency, parseSheetAmount,
  type LedgerLine, type LedgerRowInDb,
} from "../lib/finance-sync";

describe("finance sheet — parseSheetRows", () => {
  const today = "2026-09-28";

  it("maps headers regardless of column order and skips blank rows", () => {
    const values = [
      ["Notes", "ID", "Amount", "Title", "Currency", "Date", "Category", "Vendor"],
      ["", "", "185.50", "Diesel refill 40L", "MVR", "2026-09-27", "Boat Fuel", "STO"],
      ["extra", "EXP-1", "50", "Boat hired", "USD", "9/26/2026", "Boat Hire", ""],
      ["", "", "", "", "", "", "", ""],
    ];
    const rows = parseSheetRows("expense", values, today);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      { ...rows[0], vendor: rows[0].vendor },
      {
        externalId: null,
        sheetRow: 2,
        title: "Diesel refill 40L",
        // Sheet categories land as the P&L lines, whatever name was typed.
        category: "Fuel",
        amountCents: 18550,
        currency: "MVR",
        ledgerDate: "2026-09-27",
        vendor: "STO",
        notes: null,
      }
    );
    assert.equal(rows[1].externalId, "EXP-1");
    assert.equal(rows[1].ledgerDate, "2026-09-26");
    assert.equal(rows[1].amountCents, 5000);
    // An unknown name cannot invent a category.
    assert.equal(rows[1].category, "Other");
  });

  it("rejects a tab missing required headers", () => {
    assert.throws(() => parseSheetRows("income", [["ID", "Name", "Amount"]], today), /missing required headers/);
  });

  it("wraps row-level errors with the tab name and row number", () => {
    const values = [
      ["Date", "Title", "Category", "Amount", "Currency"],
      ["2026-09-27", "", "Boat Fuel", "50", "MVR"],
    ];
    assert.throws(() => parseSheetRows("expense", values, today), /Row 2 in "Expenses"/);
  });

  it("wraps a bad amount/currency cell with the row number", () => {
    const values = [
      ["Date", "Title", "Category", "Amount", "Currency"],
      ["2026-09-27", "Fuel", "Boat Fuel", "abc", "MVR"],
      ["2026-09-27", "Boat hire", "Boat Hire", "50", "EUROS"],
    ];
    assert.throws(() => parseSheetRows("expense", values, today), /Row 2 in "Expenses"/);
    assert.throws(() => parseSheetRows("expense", values, today), /Row 3 in "Expenses"/);
  });
});

describe("finance sheet — cell normalization", () => {
  it("normalizes ISO, US and serial date formats, falling back to today", () => {
    assert.equal(normalizeSheetDate("2026-09-27", "2026-09-28"), "2026-09-27");
    assert.equal(normalizeSheetDate("9/27/2026", "2026-09-28"), "2026-09-27");
    assert.equal(normalizeSheetDate("09/27/2026", "2026-09-28"), "2026-09-27");
    assert.equal(normalizeSheetDate("46222", "2026-09-28"), "2026-07-19");
    assert.equal(normalizeSheetDate("", "2026-09-28"), "2026-09-28");
    assert.equal(normalizeSheetDate("next tuesday", "2026-09-28"), "2026-09-28");
  });

  it("accepts USD/MVR case-insensitively and rejects everything else", () => {
    assert.equal(normalizeSheetCurrency("usd"), "USD");
    assert.equal(normalizeSheetCurrency("MVR"), "MVR");
    assert.throws(() => normalizeSheetCurrency("EUR"), /USD or MVR/);
  });

  it("parses major amounts to cents, strips commas, rejects <= 0", () => {
    assert.equal(parseSheetAmount("185"), 18500);
    assert.equal(parseSheetAmount("185.50"), 18550);
    assert.equal(parseSheetAmount("1,850"), 185000);
    assert.throws(() => parseSheetAmount("0"), /greater than zero/);
  });
});

describe("finance sheet — draftForSheetRow", () => {
  it("uses expense_date for expenses and income_date for income", () => {
    const row = {
      externalId: null, sheetRow: 2, title: "T", category: "Fuel",
      amountCents: 100, currency: "MVR" as const, ledgerDate: "2026-09-27",
      vendor: null, notes: null,
    };
    assert.deepEqual(draftForSheetRow("expense", row), {
      title: "T", category: "Fuel", amount_cents: 100, currency: "MVR",
      vendor: null, notes: null, expense_date: "2026-09-27",
    });
    assert.deepEqual(draftForSheetRow("income", row), {
      title: "T", category: "Fuel", amount_cents: 100, currency: "MVR",
      vendor: null, notes: null, income_date: "2026-09-27",
    });
  });
});

describe("finance sheet — reconcileLedger", () => {
  const line = (ext: string | null, sheetRow: number, title: string): LedgerLine => ({
    kind: "expense",
    externalId: ext,
    sheetRow,
    insert: { title, category: "Fuel", amount_cents: 100, currency: "USD", expense_date: "2026-09-27", vendor: null, notes: null },
  });

  it("inserts rows without an ID and writes their generated ID back", () => {
    let n = 0;
    const outcome = reconcileLedger([], [line(null, 2, "Row two"), line(null, 3, "Row three")], () => `EXT-AA${++n}`);
    assert.equal(outcome.inserts, 2);
    assert.equal(outcome.toInsert[0].externalId, "EXT-AA1");
    assert.deepEqual(outcome.writeBacks, [
      { sheetRow: 2, externalId: "EXT-AA1" },
      { sheetRow: 3, externalId: "EXT-AA2" },
    ]);
  });

  it("updates a changed existing row and inserts when the sheet ID is unknown", () => {
    const outcome = reconcileLedger([{ id: "d1", external_id: "EXP-1", archived_at: null }], [line("EXP-1", 2, "Changed title"), line("EXP-9", 3, "New")], () => "EXT-BB1");
    assert.equal(outcome.updates, 1);
    assert.equal(outcome.toUpdate[0].id, "d1");
    assert.equal(outcome.toUpdate[0].patch.title, "Changed title");
    assert.equal(outcome.inserts, 1);
    assert.equal(outcome.toInsert[0].externalId, "EXP-9");
    assert.equal(outcome.writeBacks.length, 0);
  });

  it("restores archived rows that reappear and cleans archived_at", () => {
    const existing: LedgerRowInDb[] = [
      { id: "d1", external_id: "EXP-1", archived_at: "2026-09-01T00:00:00Z" },
    ];
    const outcome = reconcileLedger(existing, [line("EXP-1", 2, "Back in sheet")], () => "EXT-CC1");
    assert.equal(outcome.restores, 1);
    assert.equal(outcome.updates, 0);
    assert.equal(outcome.toUpdate[0].patch.archived_at, null);
    assert.ok(!("archived_at" in outcome.toArchive));
  });

  it("archives sheet-owned rows no longer present in the sheet", () => {
    const existing: LedgerRowInDb[] = [
      { id: "d1", external_id: "EXP-1", archived_at: null }, // present in sheet, stays
      { id: "d2", external_id: "EXP-2", archived_at: null }, // missing -> archive
      { id: "d3", external_id: "EXP-3", archived_at: "2026-09-01T00:00:00Z" }, // missing but already archived -> skip
      { id: "d4", external_id: null, archived_at: null }, // created in-app, not sheet-owned -> skip
    ];
    const outcome = reconcileLedger(existing, [line("EXP-1", 2, "Still here")], () => "EXT-DD1");
    assert.deepEqual(outcome.toArchive, ["d2"]);
    assert.equal(outcome.archives, 1);
  });
});