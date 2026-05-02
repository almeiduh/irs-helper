# IRS Helper

IRS Helper automates one of the most error-prone parts of filing Portuguese IRS: moving broker report data into the official XML declaration format.

## Business Goal

Taxpayers who invest through platforms such as XTB, Trade Republic, Trading 212, ActivoBank, DEGIRO, and E*TRADE often need to manually transcribe values into IRS annex tables. That manual work is slow, repetitive, and easy to get wrong.

IRS Helper reduces that effort by extracting data from broker PDFs, CSV exports, and XLSX workbooks, then enriching the IRS XML file with the right table rows while still allowing manual verification before submission.

## What The Application Does

1. Reads broker reports, CSV exports, and XLSX workbooks, then extracts supported transaction rows.
2. Inserts those rows into the proper IRS XML annex sections.
3. Generates a visual report of what was added.
4. Shows a before/after XML diff so users can audit changes.
5. Lets users download the enriched XML for import into their tax workflow.

## Supported Scope

- Broker reports: XTB, Trade Republic, Trading 212, ActivoBank, DEGIRO, and E*TRADE
- IRS annexes and tables: Anexo J and Anexo G (supported subsets)
- Languages: English and Portuguese

## Privacy And Security

All processing is performed in the browser.

- No user files are uploaded to external servers.
- No backend is required for enrichment.
- XML, PDF, CSV, and XLSX files remain on the user machine during processing.
- E*TRADE USD/EUR conversion downloads public ECB exchange rates when they are not already cached in the browser.

## Typical Workflow

1. Upload the base IRS XML declaration file.
2. Upload one or more broker reports, CSV exports, or XLSX workbooks.
3. Run enrichment.
4. Review the enrichment summary and XML diff.
5. Download the generated XML.

## Why This Is Valuable

- Reduces manual tax preparation time.
- Lowers transcription mistakes in tax table entries.
- Improves confidence with transparent before/after comparison.
- Supports a privacy-first filing process.

## Product Notes

IRS Helper is a support tool, not tax advice software.

- Users remain responsible for validating all generated values.
- Users should confirm legal and fiscal applicability to their own case.

## Local Development

### Prerequisites

- Node.js LTS
- npm

### Run

```bash
npm install
npm run dev
```

### Quality Checks

```bash
npm run lint
npm run test
npm run build
```

## License

This project is licensed under the PolyForm Noncommercial License 1.0.0.

- You may use, copy, modify, and distribute this software for non-commercial purposes.
- Commercial use is not permitted without a separate commercial license from the copyright holder.

See [LICENSE](LICENSE) for the full text.
