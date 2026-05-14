---
name: irs_annexes_specialist
description: "Use when questions involve Portuguese IRS Annex G or Annex J filling rules, field codes, income codes, country codes, capital gains reporting, dividends, interest, CFDs, or how data from international brokers (XTB, Trade Republic, Trading 212, ActivoBank, Freedom24 or others) maps to IRS declaration tables. Trigger phrases: 'which annex', 'which table', 'which code', 'Quadro 8A', 'Quadro 9.2', 'Anexo G', 'Anexo J', 'IRS filling', 'income code', 'country code', 'broker PDF', 'capital gains Portugal', 'dividends IRS'."
---
# Portuguese IRS Annexes — Field Mapping Reference

This skill provides the rules and reference data for mapping broker-extracted financial data to the correct Portuguese IRS Annex G and Annex J tables and XML fields. Apply it whenever a task requires determining which annex, table, field name, income code, or country code to use for a given transaction type.

---

## Domain Knowledge

### Annex J — Foreign-sourced income

**Quadro 8A** — Dividends and interest from foreign entities held directly by the taxpayer (not via a Portuguese broker). Used when the withholding was applied abroad.
- XML container: `AnexoJq08AT01`
- Row fields: `NLinha` (starts at 801), `CodRendimento`, `CodPais`, `RendimentoBruto`, `ImpostoPagoEstrangeiroPaisFonte`
- Soma nodes: `AnexoJq08AT01SomaC01` (gross income), `AnexoJq08AT01SomaC02` (tax paid abroad)
- Common income codes:
  - `E11` — foreign dividends
  - `E21` — cash/deposit interest (ordinary foreign interest)
  - `E31` — income from foreign investment funds / money market funds

**Quadro 9.2A** — Capital gains from disposal of foreign assets (shares, ETFs, funds) held at foreign brokers.
- XML container: `AnexoJq092AT01`
- Row fields: `NLinha` (starts at 951), `CodPais`, `Codigo`, `AnoRealizacao`, `MesRealizacao`, `DiaRealizacao`, `ValorRealizacao`, `AnoAquisicao`, `MesAquisicao`, `DiaAquisicao`, `ValorAquisicao`, `DespesasEncargos`, `ImpostoPagoNoEstrangeiro`, `CodPaisContraparte`
- Soma nodes: SomaC01 (ValorRealizacao), SomaC02 (ValorAquisicao), SomaC03 (DespesasEncargos), SomaC04 (ImpostoPagoNoEstrangeiro)
- Common security class codes:
  - `G01` — direct shares / equities
  - `G10` — bonds / debt instruments
  - `G20` — units in investment funds / ETFs / UCITS funds
  - `G50` — other securities when no more specific code applies

**Quadro 9.2B** — Other foreign investment income (interest, lending income, crypto staking/rewards) that does not qualify for 8A treatment.
- XML container: `AnexoJq092BT01`
- Row fields: `NLinha` (starts at 991), `CodRendimento`, `CodPais`, `RendimentoLiquido`, `ImpostoPagoEstrangeiro`
- Soma nodes: SomaC01 (RendimentoLiquido), SomaC02 (ImpostoPagoEstrangeiro)

---

### Annex G — Capital gains on Portuguese-regulated assets

**Quadro 9** — Shares or securities sold through a Portuguese financial intermediary (e.g. ActivoBank).
- XML container: `AnexoGq09T01`
- Row fields: `NLinha` (starts at 9001), `Titular`, `NIF`, `CodEncargos`, `AnoRealizacao`, `MesRealizacao`, `DiaRealizacao`, `ValorRealizacao`, `AnoAquisicao`, `MesAquisicao`, `DiaAquisicao`, `ValorAquisicao`, `DespesasEncargos`, `PaisContraparte`

**Quadro 13** — Derivatives and CFDs (Contratos por Diferenças).
- XML container: `AnexoGq13T01`
- Row fields: `CodigoOperacao`, `Titular`, `RendimentoLiquido`, `PaisContraparte`
- Current IRS Helper implementation uses `G51` for imported options / CFD result rows.

**Quadro 18A** — Taxable crypto-asset disposals held for less than 365 days.
- XML container: `AnexoGq18AT01`
- Row fields: `NLinha`, `Titular`, `CodPaisEntGestora`, `AnoRealizacao`, `MesRealizacao`, `DiaRealizacao`, `ValorRealizacao`, `AnoAquisicao`, `MesAquisicao`, `DiaAquisicao`, `ValorAquisicao`, `DespesasEncargos`, `CodPaisContraparte`

**Anexo G1 — Quadro 7** — Exempt crypto-asset disposals held for at least 365 days.
- XML container: `AnexoG1q07T01`
- Row fields: `NLinha`, `Titular`, `CodPaisEntGestora`, `AnoRealizacao`, `MesRealizacao`, `DiaRealizacao`, `ValorRealizacao`, `AnoAquisicao`, `MesAquisicao`, `DiaAquisicao`, `ValorAquisicao`, `DespesasEncargos`, `CodPaisContraparte`

---

### Decision Logic: Annex G vs Annex J

| Situation | Annex |
|-----------|-------|
| Sale of shares/ETFs through a Portuguese broker (ActivoBank) | **G – Quadro 9** |
| Sale of shares/ETFs through a foreign broker | **J – Quadro 9.2A** |
| Dividends withheld abroad, paid directly by foreign issuer | **J – Quadro 8A** |
| Interest from foreign savings/bonds, paid by foreign broker | **J – Quadro 8A** |
| CFDs / derivatives | **G – Quadro 13** |
| Lending income, foreign crypto rewards | **J – Quadro 9.2B** |
| Crypto disposal held < 365 days | **G – Quadro 18A** |
| Crypto disposal held >= 365 days | **G1 – Quadro 7** |

---

### Supported Brokers and Tables

| Broker | Tables populated |
|--------|-----------------|
| XTB (capital gains PDF) | J-9.2A, G-13 |
| XTB (dividends PDF) | J-8A |
| Trade Republic | J-8A, J-9.2A, J-9.2B |
| Trading 212 | J-8A, J-9.2A |
| ActivoBank | G-9 |
| Freedom24 | J-8A, J-9.2A, J-9.2B |
| IBKR | J-8A, J-9.2A, G-13 |
| DEGIRO | J-9.2A |
| Binance (XLSX) | G-18A (crypto < 365 days), G1-Q7 (crypto ≥ 365 days) |

---

### Country Codes

Use AT-style **3-digit numeric country codes**, not alpha-2 codes. Examples: `840` (United States), `372` (Ireland), `276` (Germany), `250` (France), `196` (Cyprus), `440` (Lithuania), `620` (Portugal), `752` (Sweden).

- `CodPais` identifies the source country of the income or the asset country used by the parser.
- `CodPaisContraparte` / `PaisContraparte` identifies the counterparty or market country.
- When a broker file exposes only a single usable country field, mirror the same numeric code into both `CodPais` and `CodPaisContraparte`.

---

## Default Rulings for New Broker Integrations

Use these defaults without web lookup unless the scenario falls outside them or the user explicitly asks for updated AT guidance.

### Foreign dividends and interest
- Use **Anexo J – Quadro 8A**.
- Income code defaults: `E11` for foreign dividends, `E21` for ordinary foreign cash/deposit interest, `E31` for foreign investment fund income.
- Field mapping: `CodRendimento` = income code, `CodPais` = source/withholding country, `RendimentoBruto` = gross amount, `ImpostoPagoEstrangeiroPaisFonte` = foreign withholding tax.
- Use gross income, not net income after fees.
- Do not treat service fees, custody fees, or broker commissions as foreign withholding tax.
- If the statement provides both original-currency and EUR-equivalent amounts, prefer the EUR values already shown in the file.

### Foreign share, ETF, and fund disposals
- Use **Anexo J – Quadro 9.2A** for disposals through foreign brokers.
- Use **Anexo G – Quadro 9** for disposals through Portuguese financial intermediaries.
- Security class code defaults: `G01` for equities, `G10` for bonds, `G20` for ETFs/UCITS funds, `G50` only when no more specific class applies.
- Field mapping: `CodPais` = asset/source country, `Codigo` = security class code, sale date fields, `ValorRealizacao` = gross proceeds, acquisition date fields, `ValorAquisicao` = cost basis, `DespesasEncargos` = commissions/disposal charges, `ImpostoPagoNoEstrangeiro = 0.00` unless file explicitly shows foreign tax on the disposal, `CodPaisContraparte = CodPais` when the statement does not expose a separate counterparty/market country.
- If the statement already gives buy date, sell date, basis, proceeds, and charges per row, do not reconstruct FIFO lots.

### Derivatives and CFDs
- Use **Anexo G – Quadro 13**.
- IRS Helper currently uses `G51` for imported derivative-result rows.

### Crypto disposals
- Use **Anexo G – Quadro 18A** for disposals held for less than 365 days.
- Use **Anexo G1 – Quadro 7** for disposals held for at least 365 days.
- If the statement does not provide reliable EUR values or a reliable per-transaction FX basis, prefer returning a warning instead of creating XML rows automatically.
- Do not assume reward/staking lots with `0` acquisition cost are a complete tax answer by themselves; reward receipt treatment may be separate from later disposal treatment.

### Country selection heuristics
- For dividends and interest, prefer the issuer/withholding country when the statement makes it clear.
- For disposal rows, use the asset/source country exposed by the statement.
- If the file exposes only one usable country field, it is acceptable to mirror that country into both `CodPais` and `CodPaisContraparte`.

### Non-reportable broker movements
- Ignore purely mechanical cash-management or sweep movements that do not represent an actual taxable disposal or an income event.
- Only create rows for economic events that map to Annex G / J tables: dividends, interest, disposals, derivatives, and taxable crypto events.

---

## XML Format Rules

- All monetary values use period as decimal separator with 2 decimal places (e.g. `1234.56`).
- Dates use separate year/month/day fields as strings (`AnoRealizacao`, `MesRealizacao`, `DiaRealizacao`).
- `NLinha` is a globally-incrementing line number within each table block; the IRS Helper continues from the highest existing value in the XML.
- Sums are recalculated by adding newly inserted rows to any pre-existing totals already in the XML.

---

## Approach

1. Identify the transaction type (dividends, capital gains, interest, CFD, etc.) and the broker or country context.
2. Determine the correct annex and table using the decision logic above.
3. Map each data point to the exact XML field name and format.
4. If the question relates to the codebase, read the relevant source files to give a precise, code-level answer.
5. Use the built-in default rulings in this skill first.
6. If AT rules or income codes are still uncertain after applying this skill and reading the codebase, fetch the OCC IRS reference guide at `https://portal.occ.pt/sites/default/files/public/2025-04/2025-ESSENCIAL-IRS-DIGITAL_1.pdf` before answering.

---

## Constraints

- DO NOT provide generic tax advice or opinions about which deductions to claim.
- DO NOT speculate about tax years not mentioned; if uncertain, fetch the current AT guidelines from the web.
- DO NOT answer questions unrelated to Annex G, Annex J, or the broker PDF parsing pipeline.
- ONLY provide precise, field-level answers about IRS Modelo 3 XML structure and AT rules.
- Treat the built-in defaults in this skill as authoritative for already-documented scenarios.

---

## Output Format

Return a concise, structured answer with:
- **Annex and table** (e.g., "Anexo J – Quadro 9.2A")
- **XML field mapping** (field name → value) when relevant
- **Income/country code** when asked
- **Rationale** in one or two sentences citing the AT rule or codebase logic

Do not add disclaimers about seeking a tax advisor unless the question is about a genuinely edge-case legal interpretation.
