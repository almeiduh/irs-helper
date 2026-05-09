import { describe, it, expect, vi } from 'vitest';
import { parseBigCapitalGainsPdf } from './bigParser';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

// Helpers to build mock PDF text for BIG VALIAS PDFs

function bigHeader() {
  return 'Cálculo de Valias para Efeitos Fiscais Ano: 2025 Contribuinte N.º: 999999990';
}

function foreignSecurity(isin: string, currency = 'EUR', country = 'IRLANDA') {
  return `- ${isin} - ${currency} País emitente - ${country} ABERTURA FECHO`;
}

function ptSecurity(isin: string, emitterNif: string, currency = 'EUR') {
  return `- ${isin} - ${currency} Emitente ${emitterNif} - PORTUGAL ABERTURA FECHO`;
}

function txRow(
  openDate: string,
  openPrice: string,
  openValue: string,
  closeDate: string,
  closePrice: string,
  closeValue: string,
  qty: string,
  charges: string,
  gain: string,
) {
  return `${openDate} ${openPrice} ${openValue} ${closeDate} ${closePrice} ${closeValue} ${qty} ${charges} ${gain}`;
}

describe('parseBigCapitalGainsPdf', () => {
  describe('file validation', () => {
    it('throws big_wrong_file when PDF lacks BIG markers', async () => {
      mockPdfDocument([{ str: 'Some unrelated document content' }]);
      const file = new File([''], 'other.pdf');
      await expect(parseBigCapitalGainsPdf(file)).rejects.toMatchObject({
        i18nKey: 'parser.error.big_wrong_file',
      });
    });

    it('throws big_no_rows when markers present but no transactions found', async () => {
      mockPdfDocument([{ str: bigHeader() }]);
      const file = new File([''], 'VALIAS_2025_NIF_999999990.pdf');
      await expect(parseBigCapitalGainsPdf(file)).rejects.toMatchObject({
        i18nKey: 'parser.error.big_no_rows',
      });
    });
  });

  describe('foreign equity (rows92A)', () => {
    it('extracts a foreign equity row into rows92A with country from ISIN', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('IE0099999991', 'EUR', 'IRLANDA') },
        { str: txRow('2016-07-13', '7,9250', '1.600,85', '2025-11-25', '10,6420', '2.149,68', '202', '9,88', '538,96') },
      ]);

      const file = new File([''], 'VALIAS_2025_NIF_999999990.pdf');
      const data = await parseBigCapitalGainsPdf(file);

      expect(data.rows92A).toHaveLength(1);
      expect(data.rowsG9).toHaveLength(0);
      expect(data.rows92A[0]).toMatchObject({
        codPais: '372',
        codigo: 'G01',
        anoRealizacao: '2025',
        mesRealizacao: '11',
        diaRealizacao: '25',
        valorRealizacao: '2149.68',
        anoAquisicao: '2016',
        mesAquisicao: '7',
        diaAquisicao: '13',
        valorAquisicao: '1600.85',
        despesasEncargos: '9.88',
        impostoPagoNoEstrangeiro: '0',
        codPaisContraparte: '620',
      });
    });

    it('resolves country from ISIN prefix when country name is also available', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('US0099999991', 'USD', 'EUA') },
        { str: txRow('2017-02-22', '15,0000', '649,90', '2025-10-01', '26,0000', '1.124,50', '43', '8,77', '465,83') },
      ]);

      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);

      expect(data.rows92A[0].codPais).toBe('840');
    });

    it('handles multiple securities across the same page', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('IE0099999991', 'EUR', 'IRLANDA') },
        { str: txRow('2016-07-13', '7,9250', '499,17', '2025-11-25', '10,6420', '686,41', '63', '8,95', '178,30') },
        { str: foreignSecurity('US0099999991', 'USD', 'EUA') },
        { str: txRow('2017-02-22', '15,0000', '649,90', '2025-10-01', '26,0000', '1.124,50', '43', '8,77', '465,83') },
      ]);

      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);

      expect(data.rows92A).toHaveLength(2);
      expect(data.rows92A[0].codPais).toBe('372');
      expect(data.rows92A[1].codPais).toBe('840');
    });
  });

  describe('Portuguese securities (rowsG9)', () => {
    it('routes Portuguese security to rowsG9 with emitter NIF', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: ptSecurity('PT0099999991', '500000001', 'EUR') },
        { str: txRow('2021-06-08', '100,0000%', '6.000,00', '2025-02-11', '125,0000%', '7.500,00', '60', '46,25', '1.453,75') },
      ]);

      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);

      expect(data.rowsG9).toHaveLength(1);
      expect(data.rows92A).toHaveLength(0);
      expect(data.rowsG9[0]).toMatchObject({
        titular: 'A',
        nif: '500000001',
        codEncargos: 'G03',
        anoRealizacao: '2025',
        mesRealizacao: '2',
        diaRealizacao: '11',
        valorRealizacao: '7500.00',
        anoAquisicao: '2021',
        mesAquisicao: '6',
        diaAquisicao: '8',
        valorAquisicao: '6000.00',
        despesasEncargos: '46.25',
        paisContraparte: '620',
      });
    });
  });

  describe('bond detection', () => {
    it('assigns G01 for equity (no % in prices)', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('IE0099999991', 'EUR', 'IRLANDA') },
        { str: txRow('2016-07-13', '7,9250', '499,17', '2025-11-25', '10,6420', '686,41', '63', '8,95', '178,30') },
      ]);
      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);
      expect(data.rows92A[0].codigo).toBe('G01');
    });

    it('assigns G10 for bond redeemed at par (close price ~100%)', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('DE0001102523', 'EUR', 'ALEMANHA') },
        { str: txRow('2021-01-15', '98,5000%', '9.850,00', '2025-01-15', '100,0000%', '10.000,00', '100', '25,00', '125,00') },
      ]);
      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);
      expect(data.rows92A[0].codigo).toBe('G10');
    });

    it('assigns G03 for bond sold not at par', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('DE0001102523', 'EUR', 'ALEMANHA') },
        { str: txRow('2021-01-15', '98,5000%', '9.850,00', '2025-06-01', '105,2500%', '10.525,00', '100', '25,00', '650,00') },
      ]);
      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);
      expect(data.rows92A[0].codigo).toBe('G03');
    });
  });

  describe('number parsing', () => {
    it('correctly parses Portuguese number format with thousands separator', async () => {
      mockPdfDocument([
        { str: bigHeader() },
        { str: foreignSecurity('IE0099999991', 'EUR', 'IRLANDA') },
        { str: txRow('2016-07-13', '7,9250', '1.600,85', '2025-11-25', '10,6420', '2.149,68', '202', '9,88', '538,96') },
      ]);

      const file = new File([''], 'VALIAS_2025.pdf');
      const data = await parseBigCapitalGainsPdf(file);

      expect(data.rows92A[0].valorAquisicao).toBe('1600.85');
      expect(data.rows92A[0].valorRealizacao).toBe('2149.68');
      expect(data.rows92A[0].despesasEncargos).toBe('9.88');
    });
  });
});
