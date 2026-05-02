import { describe, it, expect, vi } from 'vitest';
import { parseTradeRepublicPdf } from './tradeRepublicParser';
import { BrokerParsingError } from '../parserErrors';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

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
