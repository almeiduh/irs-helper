import { describe, it, expect, vi } from 'vitest';
import { parseIbkrPdf } from './ibkrParser';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

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
    const fiiText =
      'Financial Instrument Information Symbol Description Conid Security ID Underlying Listing Exch Multiplier Type Code ' +
      'ADBE Adobe Inc 265768 US00724F1012 ADBE NASDAQ 1 COMMON ' +
      'BABA Alibaba Group 300000 US01609W1027 BABA NYSE 1 ADR ';

    const divText =
      ' Dividends Date Description Amount ' +
      '2025-07-10 BABA(US01609W1027) Cash Dividend USD 1.05 per Share (Ordinary Dividend) 10.50 ' +
      'Total Dividends ';

    mockPdfDocument(ibkrPage(fiiText + divText));

    const file = new File([''], 'ibkr_fii.pdf');
    const data = await parseIbkrPdf(file);
    expect(data.rows8A.length).toBeGreaterThan(0);
    expect(data.rows8A[0].codPais).toBe('840');
  });

  it('parses EUR stock trades with FIFO matching and creates correct TaxRow', async () => {
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
    expect(row.codPais).toBe('276');
    expect(row.anoRealizacao).toBe('2025');
    expect(row.mesRealizacao).toBe('11');
    expect(row.diaRealizacao).toBe('11');
    expect(row.valorRealizacao).toBe('449.32');
    expect(row.valorAquisicao).toBe('462.03');
    expect(row.despesasEncargos).toBe('1.25');
    expect(row._asset).toBe('3S0 (DE000A0F6MD5)');
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

    expect(data.rows92A.length).toBe(2);
    expect(data.rows92A[0].anoAquisicao).toBe('2025');
    expect(data.rows92A[0].mesAquisicao).toBe('1');
    expect(data.rows92A[1].mesAquisicao).toBe('3');
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
    expect(row.codPais).toBe('380');
    expect(row.rendimentoBruto).toBe('18.80');
    expect(row.impostoPago).toBe('4.89');
    expect(row._asset).toBe('FILA (IT0004967292)');
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
      '2025-08-15, 12:17:40 2 3.8100 3.8100 -762.00 -1.40 763.40 0.00 0.00 O;P ' +
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
