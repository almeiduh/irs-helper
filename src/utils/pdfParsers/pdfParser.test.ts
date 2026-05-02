import { describe, it, expect, vi } from 'vitest';
import {
  parseXtbCapitalGainsPdf,
  parseXtbDividendsPdf,
} from './xtbParser';
import { parseTradeRepublicPdf } from './tradeRepublicParser';
import { parseTrading212Pdf } from './trading212Parser';
import { parseIbkrPdf } from './ibkrParser';
import { parseRevolutConsolidatedPdf } from './revolutParser';
import { resolveCountryCode } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';
import * as pdfjsLib from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => {
  return {
    getDocument: vi.fn(),
    GlobalWorkerOptions: {}
  };
});

// Helper to mock a PDF with given text items
function mockPdfDocument(items: { str: string }[]) {
  const getDocumentMock = vi.mocked(pdfjsLib.getDocument);

  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items })
      })
    })
  } as unknown as ReturnType<typeof pdfjsLib.getDocument>);
}

describe('parseXtbCapitalGainsPdf', () => {
  it('should extract 9.2A, 9.2B, and G13 rows (no 8A)', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias' },
      { str: ' ' },
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620' },
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
      { str: '951 372 G20 2025 6 16 105,84 2024 6 26 104,04 0,00 0,00 620' },
      { str: '991 G98 372 25,32 0,00 620' },
      { str: '13001 G51 A -43,94 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains_commas.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A[0].valorRealizacao).toBe('105.84');
    expect(data.rows92B[0].rendimentoLiquido).toBe('25.32');
    expect(data.rowsG13[0].rendimentoLiquido).toBe('-43.94');
  });

  it('should parse 9.2A rows whose source line number is above 999', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienacao Mais-Valias' },
      { str: '1000 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620' },
      { str: '1001 372 G20 2025 6 17 205.84 2024 6 27 154.04 1.00 0.00 620' },
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
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620' },
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

describe('parseTradeRepublicPdf', () => {
  it('should extract 8A rows from a TR report', async () => {
    mockPdfDocument([
      { str: 'Trade Republic Tax Report 2025' },
      { str: ' ' },
      { str: '801' },
      { str: ' ' },
      { str: 'E21 (28%)' },
      { str: ' ' },
      { str: '276' },
      { str: ' ' },
      { str: '110,8900' },
      { str: ' ' },
      { str: '0,0000' },
    ]);

    const fakeFile = new File([''], 'tr_report.pdf');
    const data = await parseTradeRepublicPdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows8A[0].codigo).toBe('E21');
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should extract 9.2A capital gains rows from a TR report', async () => {
    mockPdfDocument([
      { str: 'Trade Republic Tax Report 2025' },
      { str: ' ' },
      { str: '951 528 G01 2025 10 2 1 768,00 2024 1 24 1 560,00 2,00 0,0000 276Sim Não' },
    ]);

    const fakeFile = new File([''], 'tr_report.pdf');
    const data = await parseTradeRepublicPdf(fakeFile);

    expect(data.rows8A.length).toBe(0);
    expect(data.rows92A).toEqual([{
      codPais: '528',
      codigo: 'G01',
      anoRealizacao: '2025',
      mesRealizacao: '10',
      diaRealizacao: '2',
      valorRealizacao: '1768.00',
      anoAquisicao: '2024',
      mesAquisicao: '1',
      diaAquisicao: '24',
      valorAquisicao: '1560.00',
      despesasEncargos: '2.00',
      impostoPagoNoEstrangeiro: '0.0000',
      codPaisContraparte: '276',
    }]);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should throw PdfParsingError when file is not a TR report', async () => {
    mockPdfDocument([
      { str: 'Some random document with no broker markers' },
    ]);

    const fakeFile = new File([''], 'not_tr.pdf');
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.tr_wrong_file',
    });
  });

  it('should throw PdfParsingError when TR report has no 8A data', async () => {
    mockPdfDocument([
      { str: 'Trade Republic Tax Report 2025 - no data' },
    ]);

    const fakeFile = new File([''], 'tr_empty.pdf');
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.tr_no_rows',
    });
  });
});

describe('parseTrading212Pdf', () => {
  it('should extract interest (E21) and dividends (E11) from T212 annual statement', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Overview  Trading 212 Invest  Interest on cash   €133.37  Share lending interest   €0.02  Dividends by country  ISSUING COUNTRY GROSS AMOUNT (EUR)   WHT RATE   WHT (EUR)   NET AMOUNT (EUR)  Germany   0.29   26%   0.08   0.21  Denmark   25.33   27%   6.84   18.49  United Kingdom   2.89   -   -   2.89  Dividends by instrument  INSTRUMENT' },
    ]);

    const fakeFile = new File([''], 't212_statement.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    // Interest: 133.37 + 0.02 = 133.39 as E21, country 196 (Cyprus)
    expect(data.rows8A[0]).toEqual({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: '133.39',
      impostoPago: '0.00',
    });

    // Dividends: 3 countries as E11
    expect(data.rows8A[1]).toEqual({
      codigo: 'E11',
      codPais: '276',
      rendimentoBruto: '0.29',
      impostoPago: '0.08',
    });

    expect(data.rows8A[2]).toEqual({
      codigo: 'E11',
      codPais: '208',
      rendimentoBruto: '25.33',
      impostoPago: '6.84',
    });

    expect(data.rows8A[3]).toEqual({
      codigo: 'E11',
      codPais: '826',
      rendimentoBruto: '2.89',
      impostoPago: '0.00',
    });

    expect(data.rows8A.length).toBe(4);
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should extract only interest when no dividends section exists', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212 Invest  Interest on cash   €50.00  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_interest_only.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows8A[0]).toEqual({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: '50.00',
      impostoPago: '0.00',
    });
  });

  it('should handle thousand separators in T212 numbers', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212  Interest on cash   €1,234.56  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_large_interest.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    expect(data.rows8A[0].rendimentoBruto).toBe('1234.56');
  });

  it('should throw PdfParsingError when file is not a T212 report', async () => {
    mockPdfDocument([
      { str: 'Some random document with no broker markers' },
    ]);

    const fakeFile = new File([''], 'not_t212.pdf');
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_wrong_file',
    });
  });

  it('should throw PdfParsingError when T212 report has no extractable data', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212  Interest on cash   €0.00  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_empty.pdf');
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_no_rows',
    });
  });
});

describe('resolveCountryCode', () => {
  it('should resolve known country names to IRS codes', () => {
    expect(resolveCountryCode('Germany')).toBe('276');
    expect(resolveCountryCode('Denmark')).toBe('208');
    expect(resolveCountryCode('United Kingdom')).toBe('826');
    expect(resolveCountryCode('United States')).toBe('840');
    expect(resolveCountryCode('Spain')).toBe('724');
    expect(resolveCountryCode('Netherlands')).toBe('528');
    expect(resolveCountryCode('Cyprus')).toBe('196');
  });

  it('should return undefined for unknown country names', () => {
    expect(resolveCountryCode('Atlantis')).toBeUndefined();
    expect(resolveCountryCode('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// IBKR Activity Statement parser tests
// ---------------------------------------------------------------------------

// Helpers for building realistic IBKR mock text
const IBKR_HEADER = 'Activity Statement Mark-to-Market Performance Summary Realized & Unrealized Performance Summary ';

function ibkrPage(body: string): { str: string }[] {
  return [{ str: IBKR_HEADER + body }];
}

describe('parseIbkrPdf', () => {
  it('throws PdfParsingError when file is not an IBKR Activity Statement', async () => {
    mockPdfDocument([{ str: 'Some unrelated document without IBKR markers' }]);
    const file = new File([''], 'not_ibkr.pdf');
    await expect(parseIbkrPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.ibkr_wrongFile',
    });
  });

  it('throws PdfParsingError when IBKR statement has no extractable data', async () => {
    mockPdfDocument(ibkrPage('Financial Instrument Information Trades Dividends Withholding Tax Interest '));
    const file = new File([''], 'ibkr_empty.pdf');
    await expect(parseIbkrPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.ibkr_noData',
    });
  });

  it('builds instrument map from Financial Instrument Information section', async () => {
    // The FII section has: Symbol Description Conid SecurityID Underlying ListingExch Multiplier Type
    // After pdf.js joins items: TICKER DESCRIPTION CONID ISIN UNDERLYING EXCH MULT TYPE
    const fiiText =
      'Financial Instrument Information Symbol Description Conid Security ID Underlying Listing Exch Multiplier Type Code ' +
      'ADBE Adobe Inc 265768 US00724F1012 ADBE NASDAQ 1 COMMON ' +
      'BABA Alibaba Group 300000 US01609W1027 BABA NYSE 1 ADR ';

    // Add dividends so the parser doesn't throw ibkr_noData
    const divText =
      ' Dividends Date Description Amount ' +
      '2025-07-10 BABA(US01609W1027) Cash Dividend USD 1.05 per Share (Ordinary Dividend) 10.50 ' +
      'Total Dividends ';

    mockPdfDocument(ibkrPage(fiiText + divText));

    const file = new File([''], 'ibkr_fii.pdf');
    const data = await parseIbkrPdf(file);
    // Dividends extracted → BABA ISIN US01609W1027 → country 840
    expect(data.rows8A.length).toBeGreaterThan(0);
    expect(data.rows8A[0].codPais).toBe('840');
  });

  it('parses EUR stock trades with FIFO matching and creates correct TaxRow', async () => {
    // FII: 3S0 → DE000A0F6MD5 (iShares MDAX UCITS); description avoids TYPE keywords
    const fiiText =
      'Financial Instrument Information Symbol Description Conid Security ID Underlying Listing Exch Multiplier Type Code ' +
      '3S0 iShares MDAX 123456 DE000A0F6MD5 3S0 XETRA 1 COMMON ';

    const tradesText =
      ' Trades Symbol Date/Time Quantity T. Price C. Price Proceeds Comm/Fee Basis Realized P/L MTM P/L Code ' +
      'Stocks EUR ' +
      '3S0 2025-02-10, 11:13:40 47 10.4400 10.4600 -490.68 -2.52 493.20 0.00 0.94 O ' +
      '3S0 2025-11-11, 10:27:18 -47 9.5600 9.5600 449.32 -1.25 -462.03 -13.96 0.00 C ' +
      'Equity and Index Options ' +
      'Dividends Withholding Tax Interest ';

    mockPdfDocument(ibkrPage(fiiText + tradesText));

    const file = new File([''], 'ibkr_trades.pdf');
    const data = await parseIbkrPdf(file);

    expect(data.rows92A.length).toBe(1);
    const row = data.rows92A[0];
    expect(row.codigo).toBe('G20');
    expect(row.codPais).toBe('276'); // DE ISIN → Germany 276
    expect(row.anoRealizacao).toBe('2025');
    expect(row.mesRealizacao).toBe('11');
    expect(row.diaRealizacao).toBe('11');
    expect(row.valorRealizacao).toBe('449.32');
    expect(row.valorAquisicao).toBe('462.03');
    expect(row.despesasEncargos).toBe('1.25');
    expect(row.anoAquisicao).toBe('2025');
    expect(row.mesAquisicao).toBe('2');
    expect(row.diaAquisicao).toBe('10');
    expect(row.impostoPagoNoEstrangeiro).toBe('0.00');
  });

  it('splits sell across multiple buy lots (FIFO) into separate TaxRows', async () => {
    const fiiText =
      'Financial Instrument Information ' +
      'Symbol Description Conid Security ID Underlying Listing Exch Multiplier Type Code ' +
      'AAPL Apple Inc 265768 US0378331005 AAPL NASDAQ 1 COMMON ';

    const tradesText =
      ' Trades Symbol Date/Time Quantity T. Price C. Price Proceeds Comm/Fee Basis Realized P/L MTM P/L Code Stocks USD ' +
      'AAPL 2025-01-10, 09:30:00 10 150.00 150.00 -1500.00 -1.00 1501.00 0.00 0.00 O ' +
      'AAPL 2025-03-15, 09:30:00 10 160.00 160.00 -1600.00 -1.00 1601.00 0.00 0.00 O ' +
      'AAPL 2025-12-01, 09:30:00 -20 200.00 200.00 4000.00 -2.00 -3102.00 896.00 0.00 C ' +
      'Equity and Index Options Dividends Withholding Tax Interest ';

    mockPdfDocument(ibkrPage(fiiText + tradesText));

    const file = new File([''], 'ibkr_fifo.pdf');
    const data = await parseIbkrPdf(file);

    // 20 shares sold across 2 buy lots of 10 each → 2 TaxRows
    expect(data.rows92A.length).toBe(2);
    expect(data.rows92A[0].anoAquisicao).toBe('2025');
    expect(data.rows92A[0].mesAquisicao).toBe('1');
    expect(data.rows92A[1].mesAquisicao).toBe('3');
    // Each lot is 50% of the sell → valorRealizacao = 4000.00 * 0.5
    expect(data.rows92A[0].valorRealizacao).toBe('2000.00');
    expect(data.rows92A[1].valorRealizacao).toBe('2000.00');
  });

  it('parses dividend with WHT and uses WHT country code', async () => {
    const divText =
      ' Dividends Date Description Amount ' +
      '2025-05-21 FILA(IT0004967292) Cash Dividend EUR 0.40 per Share (Ordinary Dividend) 18.80 ' +
      'Total Dividends ';
    const whtText =
      ' Withholding Tax Date Description Amount ' +
      '2025-05-21 FILA(IT0004967292) Cash Dividend EUR 0.40 per Share - IT Tax -4.89 ' +
      'Total Withholding Tax ';

    mockPdfDocument(ibkrPage(divText + whtText));

    const file = new File([''], 'ibkr_div_wht.pdf');
    const data = await parseIbkrPdf(file);

    expect(data.rows8A.length).toBeGreaterThan(0);
    const row = data.rows8A[0];
    expect(row.codigo).toBe('E11');
    expect(row.codPais).toBe('380'); // IT Tax → Italy 380
    expect(row.rendimentoBruto).toBe('18.80');
    expect(row.impostoPago).toBe('4.89');
  });

  it('uses BR country code for ADR dividend with Brazil WHT', async () => {
    const divText =
      ' Dividends Date Description Amount ' +
      '2025-06-15 VALE(US91912E1055) Cash Dividend USD 0.50 per Share (Ordinary Dividend) 50.00 ' +
      'Total Dividends ';
    const whtText =
      ' Withholding Tax Date Description Amount ' +
      '2025-06-15 VALE(US91912E1055) Cash Dividend USD 0.50 per Share - BR Tax -7.50 ' +
      'Total Withholding Tax ';

    mockPdfDocument(ibkrPage(divText + whtText));

    const file = new File([''], 'ibkr_adr_br.pdf');
    const data = await parseIbkrPdf(file);

    const row = data.rows8A.find(r => r.codPais === '076');
    expect(row).toBeDefined();
    expect(row!.rendimentoBruto).toBe('50.00');
    expect(row!.impostoPago).toBe('7.50');
  });

  it('aggregates options realized P/L into a single TaxRowG13', async () => {
    const optionsText =
      ' Trades Symbol Date/Time Quantity T. Price C. Price Proceeds Comm/Fee Basis Realized P/L MTM P/L Code ' +
      ' Equity and Index Options Symbol Date/Time Quantity T. Price C. Price Proceeds Comm/Fee Basis Realized P/L MTM P/L Code ' +
      // Buy row (Realized P/L = 0)
      '2025-08-15, 12:17:40 2 3.8100 3.8100 -762.00 -1.40 763.40 0.00 0.00 O;P ' +
      // Sell row (Realized P/L = 1095.20)
      '2025-10-03, 12:52:01 -2 9.3000 9.3000 1860.00 -1.40 -763.40 1095.20 0.00 C ' +
      ' CFDs Dividends ';

    mockPdfDocument(ibkrPage(optionsText));

    const file = new File([''], 'ibkr_options.pdf');
    const data = await parseIbkrPdf(file);

    const optRow = data.rowsG13.find(r => r.paisContraparte === '840');
    expect(optRow).toBeDefined();
    expect(optRow!.codigoOperacao).toBe('G51');
    expect(optRow!.titular).toBe('A');
    expect(optRow!.rendimentoLiquido).toBe('1095.20');
  });

  it('parses credit interest into E21 row for Ireland (372)', async () => {
    const interestText =
      ' Interest Date Description Amount ' +
      'EUR Credit Interest for Oct-2025 1.07 ' +
      'USD IBKR Managed Securities (SYEP) Interest for May-2025 58.18 ' +
      'Total Interest ';

    mockPdfDocument(ibkrPage(interestText));

    const file = new File([''], 'ibkr_interest.pdf');
    const data = await parseIbkrPdf(file);

    const intRow = data.rows8A.find(r => r.codigo === 'E21');
    expect(intRow).toBeDefined();
    expect(intRow!.codPais).toBe('372');
    expect(parseFloat(intRow!.rendimentoBruto)).toBeCloseTo(59.25, 1);
    expect(intRow!.impostoPago).toBe('0.00');
  });

  it('extracts CFD realized P/L into a G13 row with Ireland (372) as counterparty', async () => {
    const fiiText =
      'Financial Instrument Information Symbol Description Conid Security ID Underlying Listing Exch Multiplier Type Code ' +
      'EWZ iShares MSCI Brazil 10000 US4642872349 EWZ NYSE 1 ETF ';

    const cfdsText =
      ' Trades Symbol Date/Time Quantity T. Price C. Price Proceeds Comm/Fee Basis Realized P/L MTM P/L Code ' +
      ' CFDs USD ' +
      'EWZ 2025-01-03, 10:12:34 23 22.5100 22.4500 -517.73 -1.00 517.73 0.00 0.00 O ' +
      'EWZ 2025-02-11, 10:33:59 -23 25.7600 25.7900 592.48 -1.00 -517.73 74.75 0.00 C ' +
      'Total EWZ 0 74.75 -2.00 0.00 74.75 0.00 ' +
      'Total CFDs 74.75 -2.00 0.00 74.75 0.00 ';

    mockPdfDocument(ibkrPage(fiiText + cfdsText + 'Dividends Total Dividends '));

    const file = new File([''], 'ibkr_cfds.pdf');
    const data = await parseIbkrPdf(file);

    const cfdRow = data.rowsG13.find(r => r.paisContraparte === '372');
    expect(cfdRow).toBeDefined();
    expect(cfdRow!.codigoOperacao).toBe('G51');
    expect(cfdRow!.rendimentoLiquido).toBe('74.75');
  });
});

// ---------------------------------------------------------------------------
// Revolut Consolidated Statement parser tests
// ---------------------------------------------------------------------------

/**
 * Build a mock single-page PDF text that represents a Revolut Extrato consolidado.
 * Section order: MMF summary → EUR Sales → EUR Dividends → USD Sales → USD Dividends → Crypto
 */
function revolutPage(body: string): { str: string }[] {
  return [{ str: 'Revolut Securities Europe UAB Extrato consolidado ' + body }];
}

const REVOLUT_FULL_MOCK =
  'Revolut Securities Europe UAB Extrato consolidado ' +
  // MMF summary
  'Operações dos Fundos Monetários Juros totais auferidos €25.8842 Comissão total €9.5642 ' +
  // EUR Sales section
  'Vendas EUR Produto ISIN País Data da compra Data da venda Base Receita bruta Comissões ' +
  'NVIDIA Corporation US88160R1014 US 01/03/2024 15/11/2024 €150.00 €155.00 €1.50 ' +
  'iShares Core MSCI World UCITS ETF IE00B4L5Y983 IE 10/06/2024 20/09/2024 €1,000.00 €1,050.00 €2.50 ' +
  // EUR Dividends section
  'Outros Rendimentos EUR Produto ISIN País Montante bruto Retenção na fonte ' +
  'SAAB AB SE0013770277 SE €0.24 €0.07 ' +
  'iShares Core MSCI World UCITS ETF IE00B4L5Y983 IE €14.67 €0 ' +
  // USD Sales section
  'Vendas USD Produto ISIN País Data da compra Data da venda Base Receita bruta Comissões ' +
  'Taiwan Semiconductor Manufacturing US8740391003 US 01/02/2024 10/07/2024 $123.45 €115.23 Taxa: 1.071 $456.78 €426.89 Taxa: 1.070 $2.50 €2.34 Taxa: 1.069 ' +
  // USD Dividends section
  'Outros Rendimentos USD Produto ISIN País Montante bruto Retenção na fonte ' +
  'ASML Holding USN070592100 US $0.28 €0.26 Taxa: 1.077 $0.033 €0.03 Taxa: 1.077 ' +
  // Crypto section
  'Operações de cripto DOGE BTC ETH';

describe('parseRevolutConsolidatedPdf', () => {
  it('throws PdfParsingError when file is not a Revolut Consolidated Statement', async () => {
    mockPdfDocument([{ str: 'Some unrelated PDF without Revolut markers' }]);
    const file = new File([''], 'not_revolut.pdf');
    await expect(parseRevolutConsolidatedPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.revolut_wrong_file',
    });
  });

  it('extracts MMF interest as E21 row 372 with correct rounding to 2dp', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    const mmfRow = data.rows8A.find(r => r.codigo === 'E21');
    expect(mmfRow).toBeDefined();
    expect(mmfRow!.codPais).toBe('372');
    expect(mmfRow!.rendimentoBruto).toBe('25.88');
    expect(mmfRow!.impostoPago).toBe('0.00');
  });

  it('extracts EUR dividends as E11 rows with correct countries', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    const divRows = data.rows8A.filter(r => r.codigo === 'E11');
    expect(divRows.length).toBeGreaterThanOrEqual(2);

    const saabRow = divRows.find(r => r.codPais === '752'); // SE → 752
    expect(saabRow).toBeDefined();
    expect(saabRow!.rendimentoBruto).toBe('0.24');
    expect(saabRow!.impostoPago).toBe('0.07');

    const ishares = divRows.find(r => r.codPais === '372' && r.rendimentoBruto === '14.67'); // IE → 372
    expect(ishares).toBeDefined();
    expect(ishares!.impostoPago).toBe('0.00');
  });

  it('extracts USD dividends as E11 rows using EUR sub-line amounts', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    const divRows = data.rows8A.filter(r => r.codigo === 'E11');
    const asmlDiv = divRows.find(r => r.codPais === '840' && r.rendimentoBruto === '0.26');
    expect(asmlDiv).toBeDefined();
    expect(asmlDiv!.impostoPago).toBe('0.03');
  });

  it('extracts EUR sales with correct G01/G20 classification and date parsing', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    // NVIDIA (no ETF/UCITS keyword) → G01, country US → 840
    const nvidiaRow = data.rows92A.find(r => r.codPais === '840' && r.valorRealizacao === '155.00');
    expect(nvidiaRow).toBeDefined();
    expect(nvidiaRow!.codigo).toBe('G01');
    expect(nvidiaRow!.anoAquisicao).toBe('2024');
    expect(nvidiaRow!.mesAquisicao).toBe('3');
    expect(nvidiaRow!.diaAquisicao).toBe('1');
    expect(nvidiaRow!.anoRealizacao).toBe('2024');
    expect(nvidiaRow!.mesRealizacao).toBe('11');
    expect(nvidiaRow!.diaRealizacao).toBe('15');
    expect(nvidiaRow!.valorAquisicao).toBe('150.00');
    expect(nvidiaRow!.despesasEncargos).toBe('1.50');
    expect(nvidiaRow!.impostoPagoNoEstrangeiro).toBe('0.00');

    // iShares (contains 'UCITS ETF') → G20, country IE → 372
    const isharesRow = data.rows92A.find(r => r.codPais === '372' && r.valorRealizacao === '1050.00');
    expect(isharesRow).toBeDefined();
    expect(isharesRow!.codigo).toBe('G20');
    expect(isharesRow!.valorAquisicao).toBe('1000.00');
  });

  it('extracts USD sales using EUR sub-line amounts', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    const tsmRow = data.rows92A.find(r => r.valorRealizacao === '426.89');
    expect(tsmRow).toBeDefined();
    expect(tsmRow!.codPais).toBe('840'); // US → 840
    expect(tsmRow!.codigo).toBe('G01');
    expect(tsmRow!.valorAquisicao).toBe('115.23');
    expect(tsmRow!.despesasEncargos).toBe('2.34');
    expect(tsmRow!.anoAquisicao).toBe('2024');
    expect(tsmRow!.mesAquisicao).toBe('2');
    expect(tsmRow!.diaAquisicao).toBe('1');
    expect(tsmRow!.anoRealizacao).toBe('2024');
    expect(tsmRow!.mesRealizacao).toBe('7');
    expect(tsmRow!.diaRealizacao).toBe('10');
  });

  it('adds crypto warning when crypto section is detected', async () => {
    mockPdfDocument([{ str: REVOLUT_FULL_MOCK }]);
    const file = new File([''], 'revolut.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    expect(data.warnings).toContain('parser.warning.revolut_crypto_usd_only');
  });

  it('does not add crypto warning when no crypto section is present', async () => {
    const noCryptoText =
      'Revolut Securities Europe UAB Extrato consolidado ' +
      'Juros totais auferidos €10.00 ' +
      'Vendas EUR NVIDIA Corporation US88160R1014 US 01/01/2024 01/06/2024 €100.00 €110.00 €1.00';
    mockPdfDocument([{ str: noCryptoText }]);
    const file = new File([''], 'revolut_no_crypto.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    expect(data.warnings).not.toContain('parser.warning.revolut_crypto_usd_only');
  });

  it('returns empty rows with no error for valid file with no data rows', async () => {
    mockPdfDocument(revolutPage('Juros totais auferidos €0 '));
    const file = new File([''], 'revolut_empty.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    expect(data.rows8A.length).toBe(0);
    expect(data.rows92A.length).toBe(0);
    expect(data.warnings.length).toBe(0);
  });

  it('handles amounts with thousands separators correctly', async () => {
    const text =
      'Revolut Securities Europe UAB Extrato consolidado ' +
      'Vendas EUR ' +
      'iShares MSCI World UCITS ETF IE00B4L5Y983 IE 01/01/2024 31/12/2024 €1,234.56 €1,300.00 €5.00';
    mockPdfDocument([{ str: text }]);
    const file = new File([''], 'revolut_thousands.pdf');
    const data = await parseRevolutConsolidatedPdf(file);

    expect(data.rows92A.length).toBe(1);
    expect(data.rows92A[0].valorAquisicao).toBe('1234.56');
    expect(data.rows92A[0].valorRealizacao).toBe('1300.00');
    expect(data.rows92A[0].despesasEncargos).toBe('5.00');
  });
});
