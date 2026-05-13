---
description: "Use when the task involves parsing, extracting, or validating data from broker tax statements in any format — PDF (XTB, Trade Republic, Trading 212, ActivoBank, Freedom24, IBKR), XLSX (Binance), or CSV (DEGIRO). Covers understanding how raw file values become IRS table rows, debugging regex or extraction patterns, adding a new broker parser, or validating that extracted rows are correct before XML injection. Trigger phrases: 'parse PDF', 'parse XLSX', 'parse CSV', 'broker PDF', 'broker file', 'extract from file', 'parser', 'pdfParser.ts', 'binanceXlsxParser.ts', 'degiroCsvParser.ts', 'rows not extracted', 'missing rows', 'wrong values', 'add broker', 'new broker support', 'validate parsed data'."
---
# File Parsing — Extraction and Validation

This skill provides guidance for parsing, extracting, and validating financial data from broker tax statement files (PDF, XLSX, CSV) in IRS Helper. Apply it whenever working on broker file parsing, whether debugging existing parsers or adding new ones.

For questions about how extracted values must map to specific IRS annex tables, fields, or income codes, apply the **`irs_annexes_specialist.md`** skill before proceeding.

## Critical Rules (from past failures)

1. **ALWAYS inspect the actual file before writing or debugging a parser.** Read real headers, date formats, operation values, and row structure from the file. Never trust documentation or assumptions.
2. **Column headers vary between brokers and even between exports from the same broker.** Use alias-based header detection (normalize to lowercase, strip spaces/punctuation, match against known aliases).
3. **Date formats are unpredictable.** Verify from the real file: `YYYY-MM-DD`, `YY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, Excel serial numbers. Implement flexible date parsing that handles the actual format.
4. **Paired rows (buy+sell legs) may have different timestamps.** Use proximity-based grouping (within 2–3 seconds) rather than exact timestamp matching.
5. **Operation/transaction names differ between brokers.** Always extract the full set of unique operation types from the real file before implementing the parser.
6. **A valid file with no taxable events is NOT an error.** Return empty rows with a `warnings` array instead of throwing. Only throw for genuinely malformed or unrecognised files.

---

## Codebase Reference

Before making any changes, read the relevant source files to understand the current implementation. The codebase evolves frequently — never rely on assumptions about function names, regex patterns, or file structure.

Key files:
- `src/utils/pdfParser.ts` — PDF parsers for most brokers
- `src/utils/binanceXlsxParser.ts` — XLSX parser for Binance
- `src/utils/degiroCsvParser.ts` — CSV parser for DEGIRO
- `src/types.ts` — shared type definitions
- `src/utils/processFiles.ts` — orchestration layer

---

## Debugging Extraction Issues

1. **Inspect the real file** to see what the data actually looks like.
2. Read the parser source for the broker in question.
3. Apply the **`irs_annexes_specialist.md`** skill to confirm which table and fields the extracted values should map to.
4. Identify the mismatch between the parser output and the expected field values.
5. Propose a fix grounded in the real data format.

---

## Adding a New Broker Parser

1. **Inspect the real file** — determine format (PDF/XLSX/CSV), headers, date format, operation types, number format, row grouping.
2. Apply the **`irs_annexes_specialist.md`** skill to identify which annex tables and field mappings apply.
3. Read existing parsers as structural reference:
   - For PDF: `src/utils/pdfParser.ts`
   - For XLSX: `src/utils/binanceXlsxParser.ts`
   - For CSV: `src/utils/degiroCsvParser.ts`
4. Define the detection strategy (headers, markers, metadata patterns).
5. Implement the parser function with:
   - Alias-based header detection for XLSX/CSV
   - Flexible date parsing that handles the actual format
   - Proximity-based row grouping if rows come in pairs
   - Warning return (not error throw) for valid files with no taxable events
6. Register the new parser in `src/utils/processFiles.ts`.

---

## Validating Extracted Rows

1. Check that all monetary fields produce correctly formatted strings (2 decimal places).
2. Check that country codes are AT 3-digit numeric strings.
3. Check that income codes match what the **`irs_annexes_specialist.md`** skill confirms.
4. Check that dates are split into separate year/month/day string fields.
5. Verify the row lands in the correct array inside `ParsedPdfData`.

---

## Constraints

- DO NOT modify `src/utils/xmlModifier.ts` unless explicitly asked.
- DO NOT guess IRS income codes or country codes — always apply the **`irs_annexes_specialist.md`** skill.
- ONLY edit parser files, type definitions, and `processFiles.ts` for parsing changes.

---

## Output Format

- **Debugging**: identify the root cause and show the corrected code snippet.
- **New broker support**: show the full parser function and the registration diff.
- **Validation**: list each field, its extracted value, and whether it passes or fails.
