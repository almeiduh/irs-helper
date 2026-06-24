import { describe, it, expect, vi } from 'vitest';
import {
  parseXtbCapitalGainsPdf,
  parseXtbDividendsPdf,
} from './xtbParser';
import { BrokerParsingError } from '../parserErrors';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

describe('parseXtbCapitalGainsPdf', () => {
  it('should extract 9.2A, 9.2B, and G13 rows (no 8A)', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias' },
      { str: ' ' },
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620 SIM' },
      { str: '991 G98 372 25.32 0.00 620' },
      { str: '13001 G51 A -43.94 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A.length).toBe(1);
    expect(data.rows92B.length).toBe(1);
    expect(data.rowsG13.length).toBe(1);
    expect(data.rows8A.length).toBe(0);
  });

  it('should normalize decimal values consistently in gains rows', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias' },
      { str: '951 372 G20 2025 6 16 105,84 2024 6 26 104,04 0,00 0,00 620 SIM' },
      { str: '991 G98 372 25,32 0,00 620' },
      { str: '13001 G51 A -43,94 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains_commas.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A[0].valorRealizacao).toBe('105.84');
    expect(data.rows92A[0].valMobAdmNeg).toBe('SIM');
    expect(data.rows92B[0].rendimentoLiquido).toBe('25.32');
    expect(data.rowsG13[0].rendimentoLiquido).toBe('-43.94');
  });

  it('should parse 9.2A rows whose source line number is above 999', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienacao Mais-Valias' },
      { str: '1000 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620 SIM' },
      { str: '1001 372 G20 2025 6 17 205.84 2024 6 27 154.04 1.00 0.00 620 SIM' },
    ]);

    const fakeFile = new File([''], 'xtb_gains_above_999.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A.length).toBe(2);
    expect(data.rows92A[0].valorRealizacao).toBe('105.84');
    expect(data.rows92A[1].valorRealizacao).toBe('205.84');
  });

  it('should throw PdfParsingError when a dividends PDF is uploaded in gains slot', async () => {
    mockPdfDocument([
      { str: 'Quadro 8 A - Dividendos e Juros' },
      { str: '801 E11 840 3.71 0.57' },
    ]);

    const fakeFile = new File([''], 'xtb_dividends.pdf');
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_wrong_file_gains',
    });
  });

  it('should throw PdfParsingError when no gains rows are found', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Capital Gains' },
      { str: 'No data in this report' },
    ]);

    const fakeFile = new File([''], 'empty_gains.pdf');
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_no_gains_rows',
    });
  });
});

describe('parseXtbDividendsPdf', () => {
  it('should extract 8A rows only', async () => {
    mockPdfDocument([
      { str: 'Quadro 8 A - Dividendos e Juros' },
      { str: '801 E11 840 3.71 0.57' },
    ]);

    const fakeFile = new File([''], 'xtb_dividends.pdf');
    const data = await parseXtbDividendsPdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should throw PdfParsingError when a gains PDF is uploaded in dividends slot', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias Capital Gains' },
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620 SIM' },
    ]);

    const fakeFile = new File([''], 'xtb_gains.pdf');
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_wrong_file_dividends',
    });
  });

  it('should throw PdfParsingError when no dividend rows are found', async () => {
    mockPdfDocument([
      { str: 'Dividendos report - empty' },
    ]);

    const fakeFile = new File([''], 'empty_div.pdf');
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_no_dividends_rows',
    });
  });
});
