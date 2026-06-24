import { describe, it, expect, vi } from 'vitest';
import { parseOpenBankPdf } from './openBankParser';
import { BrokerParsingError } from '../parserErrors';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

const HEADER = 'Open Bank S.A. openbank.pt INCREMENTOS PATRIMONIAIS DE OPÇÃO DE ENGLOBAMENTO 9.2 A';

function obPage(body: string): { str: string }[] {
  return [{ str: HEADER + ' ' + body }];
}

describe('parseOpenBankPdf', () => {
  it('throws when file does not match OpenBank markers', async () => {
    mockPdfDocument([{ str: 'Completely unrelated document' }]);
    const file = new File([''], 'other.pdf');
    await expect(parseOpenBankPdf(file)).rejects.toThrow(BrokerParsingError);
    await expect(parseOpenBankPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.openbank_wrong_file',
    });
  });

  it('throws when OpenBank report has no extractable rows', async () => {
    mockPdfDocument(obPage('No transaction data here'));
    const file = new File([''], 'openbank_empty.pdf');
    await expect(parseOpenBankPdf(file)).rejects.toThrow(BrokerParsingError);
    await expect(parseOpenBankPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.openbank_no_rows',
    });
  });

  it('extracts a single 92A row with correct fields', async () => {
    mockPdfDocument(obPage(
      '951 372 G20 2025 05 08 2,38 2023 12 28 -2,21 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows92A).toHaveLength(1);
    const row = data.rows92A[0];
    expect(row.codPais).toBe('372');
    expect(row.codigo).toBe('G20');
    expect(row.anoRealizacao).toBe('2025');
    expect(row.mesRealizacao).toBe('05');
    expect(row.diaRealizacao).toBe('08');
    expect(row.valorRealizacao).toBe('2.38');
    expect(row.anoAquisicao).toBe('2023');
    expect(row.mesAquisicao).toBe('12');
    expect(row.diaAquisicao).toBe('28');
    expect(row.valorAquisicao).toBe('-2.21');
    expect(row.despesasEncargos).toBe('0.00');
    expect(row.impostoPagoNoEstrangeiro).toBe('0.00');
    expect(row.codPaisContraparte).toBe('372');
  });

  it('extracts multiple 92A rows', async () => {
    mockPdfDocument(obPage(
      '951 372 G20 2025 05 08 2,38 2023 12 28 -2,21 0,00 0,00 sim ' +
      '961 442 G20 2025 01 08 7,58 2024 04 11 -7,04 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank_multi.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows92A).toHaveLength(2);
    expect(data.rows92A[0].codPais).toBe('372');
    expect(data.rows92A[0].valorRealizacao).toBe('2.38');
    expect(data.rows92A[1].codPais).toBe('442');
    expect(data.rows92A[1].valorRealizacao).toBe('7.58');
  });

  it('normalizes comma decimals to dots', async () => {
    mockPdfDocument(obPage(
      '999 250 G20 2025 04 02 47,57 2023 10 18 -45,12 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank_commas.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].valorRealizacao).toBe('47.57');
    expect(data.rows92A[0].valorAquisicao).toBe('-45.12');
  });

  it('uses codPais as codPaisContraparte when counterparty is not provided', async () => {
    mockPdfDocument(obPage(
      '951 372 G20 2025 05 08 2,38 2023 12 28 -2,21 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows92A[0].codPaisContraparte).toBe(data.rows92A[0].codPais);
  });

  it('handles multiple country codes', async () => {
    mockPdfDocument(obPage(
      '951 372 G20 2025 05 08 2,38 2023 12 28 -2,21 0,00 0,00 sim ' +
      '961 442 G20 2025 01 08 7,58 2024 04 11 -7,04 0,00 0,00 sim ' +
      '1047 250 G20 2025 04 02 47,57 2023 10 18 -45,12 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank_countries.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows92A).toHaveLength(3);
    expect(data.rows92A[0].codPais).toBe('372');
    expect(data.rows92A[1].codPais).toBe('442');
    expect(data.rows92A[2].codPais).toBe('250');
  });

  it('returns empty arrays for all other row types', async () => {
    mockPdfDocument(obPage(
      '951 372 G20 2025 05 08 2,38 2023 12 28 -2,21 0,00 0,00 sim'
    ));

    const file = new File([''], 'openbank.pdf');
    const data = await parseOpenBankPdf(file);

    expect(data.rows8A).toEqual([]);
    expect(data.rows92B).toEqual([]);
    expect(data.rowsG9).toEqual([]);
    expect(data.rowsG13).toEqual([]);
    expect(data.rowsG18A).toEqual([]);
    expect(data.rowsG1q7).toEqual([]);
    expect(data.warnings).toEqual([]);
  });
});
