---
name: add_broker_orchestrator
description: "Use when a new broker needs to be added to IRS Helper. Accepts a broker tax statement (PDF, XLSX, or CSV) and orchestrates the full workflow: analysing the file, mapping income types to IRS annex tables, producing an implementation plan, and delegating coding to the developer. Trigger phrases: 'add broker', 'new broker', 'support broker', 'integrate broker', 'broker PDF support', 'broker XLSX support'."
---
# Add Broker — Full Workflow

This skill guides the full process of adding support for a new investment broker to the IRS Helper application. Follow each phase in order. Do not skip phases or proceed to implementation before the plan is complete and reviewed.

## Critical Lessons (from past failures)

1. **NEVER assume file format from documentation or file names.** Always inspect the actual attached file in Phase 0 before planning.
2. **Broker files are not always PDFs.** They can be XLSX, CSV, or other formats. Identify the file type first and adapt accordingly.
3. **Column headers, date formats, and operation names MUST be verified from the real file.** Do not assume standard names — brokers use inconsistent naming (e.g. `User ID` vs `User_ID`, `Time` vs `UTC_Time`, 2-digit vs 4-digit years).
4. **Paired/grouped rows may have timestamp offsets.** Rows that logically belong together (e.g. buy crypto + spend EUR) may not share the exact same timestamp. Always plan for proximity-based grouping.
5. **Parser must handle files with valid data but no taxable events gracefully.** Return warnings instead of throwing errors for files that parse correctly but produce zero IRS rows.

---

## Phase 0 — Inspect the Actual File

**This phase is MANDATORY and must be completed BEFORE any planning.**

Inspect the attached file to determine:

1. **File format** — Is it PDF, XLSX, XLS, CSV, or something else?
2. **For XLSX/CSV**: Read the actual headers, first 5–10 data rows, and last 2–3 rows. Record:
   - Exact column header names (including casing and spaces)
   - Date/timestamp format (e.g. `YYYY-MM-DD`, `YY-MM-DD`, `DD/MM/YYYY`, Excel serial numbers)
   - Number format (decimal separators, negative number representation)
   - All unique operation/transaction types present in the file
   - All unique coin/asset/instrument identifiers
   - Whether rows come in pairs/groups (e.g. buy + sell legs of a conversion)
   - Whether there are metadata/header rows before the actual data
   - Total row count
3. **For PDF**: Extract raw text from the first 2–3 pages and identify structure markers.

Record all findings in a structured summary. These findings are the **ground truth** for the implementation plan — they override any assumptions from documentation or broker website descriptions.

---

## Phase 1 — Understand the File Structure

Using the Phase 0 findings, determine:

1. The broker name and any identifiable fingerprint markers (text patterns, headers, identifiers).
2. The income types present in the document (dividends, capital gains, interest, CFDs, crypto conversions, staking rewards, etc.).
3. The raw data structure for each income type: what columns or fields appear, their format.
4. Whether the file uses an AT pre-formatted layout or a proprietary broker format.
5. Edge cases: paired rows with timestamp offsets, multi-asset groups, crypto-to-crypto swaps, metadata rows, 2-digit years, locale-dependent number formats.

For parsing and extraction questions, apply the guidance in the **`file_parsing_specialist.md`** skill.

---

## Phase 2 — Map to IRS Annexes

For each income type identified in Phase 1, determine:

1. Which annex and table applies (Anexo G, Anexo G1, or Anexo J, and the specific Quadro).
2. The exact XML field names and their expected format.
3. The correct income code (`CodRendimento` / `Codigo`) for each income type.
4. The country code source: is it the broker's country, the asset's country of origin, or the market country?
5. Whether the broker's data maps cleanly to the table or requires transformation.

For all annex and field mapping questions, apply the guidance in the **`irs_annexes_specialist.md`** skill.

---

## Phase 3 — Produce the Implementation Plan

After gathering all information from Phases 0–2, write a detailed implementation plan using the todo list. The plan must include:

**A. File format and detection**
- The file extension(s) to accept (`.pdf`, `.xlsx`, `.csv`)
- The detection strategy: how to identify this broker's file (header fingerprinting, marker text, metadata rows)
- The exact header names from the real file, with any aliases needed
- How to locate the data start row (skip metadata rows)

**B. Data format specifics (from Phase 0 inspection)**
- Exact date/timestamp format with examples from the real file
- Number format and decimal separator
- Operation/transaction type values (exact strings from the file)
- How paired/grouped rows are associated (exact timestamp match vs proximity)
- Any multi-step conversions (crypto-to-crypto swaps, multi-leg trades)

**C. Extraction strategy per income type**
For each income type:
- The target `ParsedPdfData` array (`rows8A`, `rows92A`, `rows92B`, `rowsG9`, `rowsG13`, `rowsG18A`, `rowsG1q7`)
- The extraction approach
- The field mapping: raw file column → typed row field name → XML field name
- Any normalisation required

**D. Edge cases and graceful handling**
- What to do when the file has valid data but no taxable events (return empty rows + warning)
- What to do with crypto-to-crypto swaps (lot substitution)
- What to do with staking/earn rewards (zero-cost lots)
- How to handle partial sells (FIFO lot splitting)

**E. Parser function specification**
- Function signature
- Validation: which markers to check, what error to throw if unrecognised
- Empty arrays to return for unsupported tables
- Warning keys for valid-but-empty results

**F. Registration, UI, and i18n**
- Where to add the new parser in the orchestration layer
- The broker name constant
- The new file input slot label (in English and Portuguese)
- i18n keys to add (including warning messages)

**G. Tests**
- One test per income type: happy path with representative data **matching the real file format**
- One test for wrong-file detection
- One test for valid-but-empty handling (warning returned, no error thrown)
- One test for edge cases (2-digit years, timestamp proximity, crypto-to-crypto swaps) if applicable

**Present the implementation plan to the user for review before proceeding to Phase 4. Only proceed after the user confirms the plan is correct.**

---

## Phase 4 — Implement

With the approved plan, implement the full broker support following the **`developer.md`** skill. Key reminders:

- Use the real file's format (not assumptions) in all parsing code.
- Run the parser against the real file after implementation to verify output.
- Do not skip tests, the build check, or the service worker cache version increment.

---

## Completion Report

At the end, report:
- **Broker**: name and file type(s) supported
- **Tables populated**: which `ParsedPdfData` arrays will have rows
- **Implementation summary**: files changed and tests added
