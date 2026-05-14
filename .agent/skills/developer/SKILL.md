---
name: developer
description: "Use when implementing new features, modifying existing code, fixing bugs, adding tests, or improving coverage in the IRS Helper codebase. This is the primary coding skill for all React, TypeScript, and service worker changes. Trigger phrases: 'add feature', 'implement', 'modify', 'fix bug', 'refactor', 'add tests', 'update component', 'new parser', 'change behavior', 'cover with tests'."
---
# Developer — React/TypeScript Implementation

This skill provides the rules and process for implementing any feature, bug fix, refactor, or test change in the IRS Helper codebase. Follow all steps; do not skip any checklist items before reporting done.

## Critical Rules (from past failures)

These rules are non-negotiable and override general coding instincts:

1. **When writing a file parser, ALWAYS inspect the actual file first.** Read real headers, date formats, operation/transaction type values, number formats, and row structure from the attached or referenced file. Do this BEFORE writing any parsing code. Never assume formats from documentation, file names, or broker websites.

2. **Never hardcode column header names.** Use alias-based header detection that normalizes headers (lowercase, strip spaces/punctuation) and matches against a set of known aliases. Real files have inconsistent headers (`User ID` vs `User_ID` vs `UID`, `Time` vs `UTC_Time` vs `DateTime`).

3. **Never assume timestamp formats.** Check the real file for 2-digit vs 4-digit years, different separators, and Excel serial date numbers. Implement flexible date parsing.

4. **Use proximity-based grouping for paired rows.** When transactions come in pairs (e.g. buy crypto + spend EUR), rows may have 1–2 second timestamp offsets. Never use exact string matching for timestamps.

5. **Return warnings, not errors, for valid-but-empty results.** When a parser successfully reads a file but finds no taxable events (e.g. only buys, no sells), add i18n keys to the `warnings` array in `ParsedPdfData`. Only throw `BrokerParsingError` for genuinely malformed or unrecognised files.

6. **After implementing a parser, test it against the real file.** Run a quick terminal script to verify the parser produces expected output with the actual attached file before reporting done.

---

## Mandatory Checklist

Every implementation task MUST complete all of the following before reporting done:

1. **Read before writing** — Read all files to be modified. Understand existing patterns before adding new code.
2. **Inspect real data** — For parser tasks, inspect the actual broker file to verify formats (see Critical Rule 1).
3. **Implement the change** — Write idiomatic, well-typed TypeScript. Follow the patterns already present in the codebase.
4. **Update the service worker cache version** — Every time a new feature is added or existing behaviour changes, increment the `CACHE_NAME` version in `src/serviceWorker.ts`.
5. **Add or update tests** — Unit tests for all new logic. Include edge cases discovered during real-file inspection.
6. **Run all tests** — Execute `npm run test` and confirm every test passes.
7. **Run the build** — Execute `npm run build` and confirm no errors.
8. **Verify against real data** — For parser tasks, run the parser against the actual file and verify output.

---

## When to Apply Other Skills

- For questions about **which IRS annex, table, field, or income code** applies to a transaction, apply the **`irs_annexes_specialist.md`** skill.
- For questions about **file parsing logic, broker fingerprinting, or row extraction**, apply the **`file_parsing_specialist.md`** skill.
- For questions about **frontend consistency, UX flow quality, wording, translations, or documentation clarity**, apply the **`ui_ux_consistency_specialist.md`** skill before implementing UI behaviour.

---

## Coding Standards

- **TypeScript**: Strict types. No `any` unless unavoidable and justified. Prefer `unknown` over `any` at boundaries.
- **React**: Functional components with hooks. No class components.
- **State**: Keep state minimal. Lift only when necessary.
- **Side effects**: Isolate in `useEffect` or custom hooks.
- **Error handling**: Use typed error classes (see `BrokerParsingError` pattern) for genuinely invalid inputs. Use `warnings` array in `ParsedPdfData` for valid-but-empty results.
- **Internationalisation**: All user-facing strings must use i18n keys via `react-i18next`. Add keys to both `src/locales/en.json` and `src/locales/pt.json`.
- **No dead code**: Remove unused imports, variables, and functions introduced during implementation.

---

## Service Worker Cache Version Rule

The `CACHE_NAME` constant in `src/serviceWorker.ts` uses a version suffix (e.g. `irs-helper-v8`). **Increment this version number** whenever:
- A new feature is added
- Existing cached assets change
- A bug fix changes runtime behaviour

---

## Testing Standards

- Test files live alongside source files (`*.test.ts` / `*.test.tsx`).
- Test framework: **Vitest** with `jsdom` environment for DOM/React tests.
- Mock external dependencies (e.g. `pdfjs-dist`, `xlsx`) with `vi.mock`.
- Each new exported function needs at least: a happy-path test, an error/edge-case test.
- **For parsers**: include tests with data formats matching the REAL file (not idealized formats). Test 2-digit years if the real file has them. Test timestamp proximity if paired rows have offsets. Test valid-but-empty files return warnings.
- React components need at least: a render test, interaction tests for user-facing behaviour.
- Do not delete existing tests unless they are genuinely wrong and you replace them with correct ones.

---

## Implementation Steps

1. Use the todo list to plan all steps for non-trivial tasks.
2. Read the relevant source files before making any edits.
3. **For parser tasks: inspect the actual file first** (Critical Rule 1).
4. Apply domain-specific skills (annex mapping, parsing, UI/UX) before writing code that depends on their output.
5. Implement changes incrementally — one logical unit at a time.
6. After implementation, check for missing i18n keys and add them.
7. Increment the service worker `CACHE_NAME` version.
8. Add or update tests to cover the new behaviour.
9. Run `npm run test` and fix any failures.
10. Run `npm run build` to confirm there are no TypeScript or build errors.
11. **For parser tasks: verify output against the real file.**

---

## Output Format

When done, report:
- **What changed**: brief list of modified files and what was changed in each
- **Tests added**: which test cases were added and what they cover
- **Cache version**: old → new version number
- **Test result**: confirmation that `npm run test` passed
- **Real-file verification**: confirmation that the parser was tested against the actual broker file (for parser tasks)
