import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDegiroPdf } from './degiroParser';
import * as common from './common';
import { BrokerParsingError } from '../parserErrors';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

vi.mock('./common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./common')>();
  return {
    ...actual,
    extractPdfText: vi.fn(),
  };
});

describe('degiroParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFile = new File(['mock content'], 'test_file.pdf', { type: 'application/pdf' });

  it('throws wrong file error when missing markers', async () => {
    vi.mocked(common.extractPdfText).mockResolvedValue([
      'Random bank statement\nNothing to see here',
    ]);

    await expect(parseDegiroPdf(mockFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseDegiroPdf(mockFile)).rejects.toThrow('does not appear to be a DEGIRO Annual Report');
  });

  it('extracts dividends and coupons correctly', async () => {
    vi.mocked(common.extractPdfText).mockResolvedValue([
      `
      Visão geral da Carteira e dos Lucros/Perdas
      
      Dividendos E Outras Remunerações Ao Acionista em EUR
      País Produto Valor bruto Retenção na fonte Valor líquido
      PT EDP SA 14 000,00 EUR 4 900,00 EUR 9 100,00EUR
      US Alphabet Inc Class A 22,33 EUR 6,70 EUR 15,63EUR
      14 022,33 EUR 4 906,70 EUR 9 115,63EUR
      
      Visão geral sobre os cupões em EUR
      País Cupão bruto Retenção na fonte Cupão líquido
      DE 1 000,00 EUR 250,00 EUR 750,00 EUR
      `,
    ]);

    const result = await parseDegiroPdf(mockFile);

    expect(result.warnings).toEqual([]);
    expect(result.rows8A).toHaveLength(3);

    // PT EDP SA
    expect(result.rows8A[0]).toEqual({
      codigo: 'E11',
      codPais: '620',
      rendimentoBruto: '14000.00',
      impostoPago: '4900.00',
    });

    // US Alphabet
    expect(result.rows8A[1]).toEqual({
      codigo: 'E11',
      codPais: '840',
      rendimentoBruto: '22.33',
      impostoPago: '6.70',
    });

    // DE Coupon
    expect(result.rows8A[2]).toEqual({
      codigo: 'E21',
      codPais: '276',
      rendimentoBruto: '1000.00',
      impostoPago: '250.00',
    });
  });

  it('returns warnings when valid file has no rows', async () => {
    vi.mocked(common.extractPdfText).mockResolvedValue([
      `
      Visão geral da Carteira e dos Lucros/Perdas
      
      Dividendos E Outras Remunerações Ao Acionista em EUR
      País Produto Valor bruto Retenção na fonte Valor líquido
      
      Visão geral sobre os cupões em EUR
      País Cupão bruto Retenção na fonte Cupão líquido
      Não dispõe de cupões pagos.
      `,
    ]);

    const result = await parseDegiroPdf(mockFile);

    expect(result.rows8A).toHaveLength(0);
    expect(result.warnings).toEqual(['parser.warning.degiro_pdf_no_rows']);
  });
});
