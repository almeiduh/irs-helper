import { describe, it, expect, vi } from 'vitest';
import { parseRevolutConsolidatedPdf } from './revolutParser';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

function revolutPage(body: string): { str: string }[] {
  return [{ str: 'Revolut Securities Europe UAB Extrato consolidado ' + body }];
}

const REVOLUT_FULL_MOCK =
  'Revolut Securities Europe UAB Extrato consolidado ' +
  'Operações dos Fundos Monetários Juros totais auferidos €25.8842 Comissão total €9.5642 ' +
  'Vendas EUR Produto ISIN País Data da compra Data da venda Base Receita bruta Comissões ' +
  'NVIDIA Corporation US88160R1014 US 01/03/2024 15/11/2024 €150.00 €155.00 €1.50 ' +
  'iShares Core MSCI World UCITS ETF IE00B4L5Y983 IE 10/06/2024 20/09/2024 €1,000.00 €1,050.00 €2.50 ' +
  'Outros Rendimentos EUR Produto ISIN País Montante bruto Retenção na fonte ' +
  'SAAB AB SE0013770277 SE €0.24 €0.07 ' +
  'iShares Core MSCI World UCITS ETF IE00B4L5Y983 IE €14.67 €0 ' +
  'Vendas USD Produto ISIN País Data da compra Data da venda Base Receita bruta Comissões ' +
  'Taiwan Semiconductor Manufacturing US8740391003 US 01/02/2024 10/07/2024 $123.45 €115.23 Taxa: 1.071 $456.78 €426.89 Taxa: 1.070 $2.50 €2.34 Taxa: 1.069 ' +
  'Outros Rendimentos USD Produto ISIN País Montante bruto Retenção na fonte ' +
  'ASML Holding USN070592100 US $0.28 €0.26 Taxa: 1.077 $0.033 €0.03 Taxa: 1.077 ' +
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

    const saabRow = divRows.find(r => r.codPais === '752');
    expect(saabRow).toBeDefined();
    expect(saabRow!.rendimentoBruto).toBe('0.24');
    expect(saabRow!.impostoPago).toBe('0.07');

    const ishares = divRows.find(r => r.codPais === '372' && r.rendimentoBruto === '14.67');
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
    expect(tsmRow!.codPais).toBe('840');
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
