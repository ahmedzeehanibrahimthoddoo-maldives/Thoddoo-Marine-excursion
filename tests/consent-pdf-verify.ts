/**
 * Verification script for consent PDF: Cloudflare-compatible logo loading.
 *
 * Run with: npx tsx tests/consent-pdf-verify.ts
 *
 * This script verifies code-level correctness. No running dev server required.
 */

import { readFileSync } from "fs";
import { join } from "path";

console.log("=== Consent PDF — Cloudflare-Compatible Logo Loading ===\n");

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. consent-pdf.ts — no filesystem access
console.log("1. consent-pdf.ts — no filesystem access (Cloudflare-safe)");
const pdfPath = join(__dirname, "..", "lib", "consent-pdf.ts");
const pdf = readFileSync(pdfPath, "utf-8");

check("No import from 'fs'", !/import.*from\s+["']fs["']/.test(pdf), "fs import still present");
check("No import from 'path'", !/import.*from\s+["']path["']/.test(pdf), "path import still present");
check("No readFileSync call", !/readFileSync/.test(pdf), "readFileSync still present");
check("No process.cwd call", !/process\.cwd/.test(pdf), "process.cwd still present");
check("No require('fs')", !/require\(["']fs["']\)/.test(pdf), "require('fs') still present");
check("No require('path')", !/require\(["']path["']\)/.test(pdf), "require('path') still present");

// 2. consent-pdf.ts — logo parameter accepted
console.log("\n2. consent-pdf.ts — logo parameter");
check("generateConsentPdf accepts logoDataUrl parameter", /logoDataUrl\?:\s*string\s*\|\s*null/.test(pdf), "missing logoDataUrl parameter");
check("Logo is rendered when provided", /if\s*\(logoDataUrl\)/.test(pdf), "missing conditional logo rendering");
check("Logo rendering in try/catch for graceful fallback", /logoDataUrl[\s\S]*?try[\s\S]*?catch/.test(pdf), "missing try/catch around logo rendering");
check("Logo format detection (PNG vs JPEG)", /logoDataUrl\.includes\("image\/png"\)/.test(pdf), "missing format detection");
check("Logo added to PDF with doc.addImage", /doc\.addImage\(logoDataUrl/.test(pdf), "logo not added via addImage");

// 3. consent-pdf.ts — text header still present
console.log("\n3. consent-pdf.ts — text header fallback");
check("Thoddoo Marine text header always rendered", /THODDOO MARINE EXCURSION CENTRE/.test(pdf), "missing text header");
check("Activity Participation Consent Form subtitle", /Activity Participation Consent Form/.test(pdf), "missing subtitle");
check("Thoddoo, Maldives subtitle", /Thoddoo, Maldives/.test(pdf), "missing location");

// 4. consent-pdf.ts — medical fields
console.log("\n4. consent-pdf.ts — medical fields");
check("Has medical info check", pdf.includes("hasMedicalInfo"), "missing medical info flag");
check("Shows neutral line when no medical info", pdf.includes("No medical conditions or safety concerns were disclosed"), "missing neutral line");
check("Has conditional medical field display", pdf.includes("if (hasMedicalInfo)"), "medical fields not conditional");

// 5. consent-pdf.ts — signature labels
console.log("\n5. consent-pdf.ts — signature labels");
check("drawSignature has signatureProvided parameter", pdf.includes("signatureProvided?: boolean"), "missing signatureProvided param");
check("Null signature shows 'Not provided'", pdf.includes('"Not provided"'), "missing Not provided text");
check("Invalid signature shows 'Signature image unavailable'", pdf.includes('"Signature image unavailable"'), "missing Signature image unavailable text");
check("Guest signature uses signatureProvided=true", pdf.includes('drawSignature(doc, data.signature_data_url, margin, y, 70, 20, "Guest", true)'), "guest signature missing provided flag");
check("Witness signature uses Boolean flag", pdf.includes('Boolean(data.witness_signature_data_url)'), "witness signature missing flag");

// 6. API route — fetches logo via HTTP
console.log("\n6. API route — Cloudflare-compatible logo fetch");
const routePath = join(__dirname, "..", "app", "api", "admin", "consents", "[id]", "pdf", "route.ts");
const route = readFileSync(routePath, "utf-8");

check("No import from 'fs'", !/import.*from\s+["']fs["']/.test(route), "fs import in route");
check("No import from 'path'", !/import.*from\s+["']path["']/.test(route), "path import in route");
check("No readFileSync call", !/readFileSync/.test(route), "readFileSync in route");
check("No process.cwd call", !/process\.cwd/.test(route), "process.cwd in route");
check("Uses fetch() for logo", /fetch\(logoUrl/.test(route), "missing fetch for logo");
check("Fetches from /images/logo.jpeg", /\/images\/logo\.jpeg/.test(route), "wrong logo path");
check("Validates Content-Type includes image/jpeg", /contentType\.includes\("image\/jpeg"\)/.test(route), "missing content-type check");
check("Validates Content-Type includes image/png", /contentType\.includes\("image\/png"\)/.test(route), "missing png content-type check");
check("Enforces logo size limit (512 KB)", /MAX_LOGO_BYTES/.test(route), "missing logo size limit");
check("512 KB = 524288 bytes", /512\s*\*\s*1024/.test(route), "incorrect size limit");
check("Has fetch timeout", /LOGO_FETCH_TIMEOUT_MS/.test(route), "missing fetch timeout");
check("Timeout of 5000ms", /5000/.test(route), "incorrect timeout value");
check("Uses AbortController for timeout", /AbortController/.test(route), "missing AbortController");
check("Passes logoDataUrl to generateConsentPdf", /generateConsentPdf\(consent,\s*logoDataUrl\)/.test(route), "logo not passed to generator");

// 7. API route — graceful logo failure
console.log("\n7. API route — graceful logo failure");
check("fetchLogoDataUrl returns null on failure", /catch\s*\{[\s\S]*?return\s+null/.test(route), "missing catch handler returning null");
check("Logo fetch failure is non-blocking", /logoDataUrl = await fetchLogoDataUrl/.test(route), "logo fetch not in try/catch");
check("generateConsentPdf called even if logo is null", /generateConsentPdf\(consent,\s*logoDataUrl\)/.test(route), "conditional logo check missing");

// 8. API route — PDF size limit
console.log("\n8. API route — PDF size limit");
check("MAX_PDF_BYTES defined", /MAX_PDF_BYTES/.test(route), "missing PDF size constant");
check("PDF size check present", /pdfBuffer\.length > MAX_PDF_BYTES/.test(route), "missing PDF size check");
check("10 MB limit", /10\s*\*\s*1024\s*\*\s*1024/.test(route), "incorrect PDF limit");

// 9. API route — signature validation
console.log("\n9. API route — signature validation");
check("MAX_SIGNATURE_BYTES defined", /MAX_SIGNATURE_BYTES/.test(route), "missing signature size constant");
check("MAX_BASE64_CHARS defined", /MAX_BASE64_CHARS/.test(route), "missing base64 chars constant");
check("524288 byte limit", /524288/.test(route), "incorrect signature limit");
check("699050 char limit", /699050/.test(route), "incorrect base64 limit");

// 10. ConsentFormClient — no print/download
console.log("\n10. Public consent page — no print/download");
const cfcPath = join(__dirname, "..", "app", "consent", "[token]", "ConsentFormClient.tsx");
const cfc = readFileSync(cfcPath, "utf-8");
const consentPage = readFileSync(
  join(__dirname, "..", "app", "consent", "[token]", "page.tsx"),
  "utf-8",
);
check(
  "Success message mentions staff for PDF",
  consentPage.includes("ask Thoddoo Marine staff if you require a PDF copy"),
  "missing staff PDF mention",
);
check("No public print button in form", !cfc.includes("Print") || cfc.includes("no-print"), "unexpected print button");

// 11. Migration 009 — consent template seed
console.log("\n11. Migration 009 — consent template");
const m009 = readFileSync(join(__dirname, "..", "supabase", "migrations", "009_consent_pdf_workflow.sql"), "utf-8");
check("Has activity-consent-v1 seed", m009.includes("activity-consent-v1"), "missing template seed");
check("Template has consent_text", m009.includes("consent_text TEXT NOT NULL"), "missing consent_text column");

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);

if (fail > 0) {
  console.log("\nSome checks failed. Review the output above.");
  process.exit(1);
} else {
  console.log("\nAll code-level checks passed.");
  console.log("\n=== Manual Verification Steps ===");
  console.log("1. Create a consent form via Admin > Consents > + Create Consent");
  console.log("2. Open the consent link in incognito/clean browser");
  console.log("3. Verify the full consent text is displayed with version");
  console.log("4. Complete the form and submit");
  console.log("5. Download PDF from Admin > Consents > [row] > ⬇");
  console.log("6. Verify Thoddoo Marine logo appears in PDF header");
  console.log("7. Verify PDF still generates if logo URL is unreachable");
  console.log("8. Verify no signing token appears anywhere in the PDF");
  console.log("9. Verify page numbers appear on all PDF pages");
}
