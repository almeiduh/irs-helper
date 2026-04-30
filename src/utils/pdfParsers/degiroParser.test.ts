import { describe, expect, it, vi } from 'vitest';
import { parseDegiroAnnualPdf } from './degiroParser';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

const DEGIRO_HEADER = 'Relatório Anual 2025 www.degiro.pt flatexDEGIRO Bank Dutch Branch ';

function degiroPage(body: string): { str: string }[] {
  return [{ str: DEGIRO_HEADER + body }];
}

describe('parseDegiroAnnualPdf', () => {
  it('throws when file is not a DEGIRO annual report', async () => {
    mockPdfDocument([{ str: 'Some unrelated broker statement' }]);
    const file = new File([''], 'not-degiro.pdf');

    await expect(parseDegiroAnnualPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_pdf_wrong_file',
    });
  });

  it('extracts dividend summary rows from a Portuguese annual report', async () => {
    mockPdfDocument(degiroPage(
      'Dividendos E Outras Remunerações Ao Acionista em EUR ' +
      'País Produto Valor bruto Retenção na fonte Valor líquido ' +
      'KY ADR on Alibaba Group Holding Ltd 37,60 EUR 0,00 EUR 37,60 EUR ' +
      'US ACME COMMON STOCK 10,00 EUR 1,50 EUR 8,50 EUR ' +
      '47,60 EUR 1,50 EUR 46,10 EUR ' +
      'Visão geral sobre os cupões em EUR '
    ));
    const file = new File([''], 'degiro-annual.pdf');

    const data = await parseDegiroAnnualPdf(file);

    expect(data.rows8A).toEqual([
      {
        codigo: 'E11',
        codPais: '136',
        rendimentoBruto: '37.60',
        impostoPago: '0.00',
      },
      {
        codigo: 'E11',
        codPais: '840',
        rendimentoBruto: '10.00',
        impostoPago: '1.50',
      },
    ]);
    expect(data.rows92A).toEqual([]);
    expect(data.rowsG13).toEqual([]);
  });

  it('extracts transaction appendix rows with FIFO matching', async () => {
    mockPdfDocument(degiroPage(
      'Transações Produto Ticker / ISIN Data Quant. Preço Valor Valor em EUR Tipo de Ordem Comissão Taxa de câmbio ' +
      'VANGUARD S&P 500 UCITS ETF USD DIS IE00B3XXRP09 02-10-2020 2 54,0000 EUR -108,00 EUR -108,00 EUR Compra -1,00 EUR 1,0000 ' +
      'VANGUARD S&P 500 UCITS ETF USD DIS IE00B3XXRP09 31-05-2023 -1 74,4890 EUR 74,49 EUR 74,49 EUR Venda -1,00 EUR 1,0000 ' +
      'Relatório Anual 2025'
    ));
    const file = new File([''], 'degiro-annual.pdf');

    const data = await parseDegiroAnnualPdf(file);

    expect(data.rows92A).toEqual([{
      codPais: '372',
      codigo: 'G20',
      anoRealizacao: '2023',
      mesRealizacao: '5',
      diaRealizacao: '31',
      valorRealizacao: '74.49',
      anoAquisicao: '2020',
      mesAquisicao: '10',
      diaAquisicao: '2',
      valorAquisicao: '54.00',
      despesasEncargos: '1.50',
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: '620',
      _asset: 'VANGUARD S&P 500 UCITS ETF USD DIS (IE00B3XXRP09)',
    }]);
  });

  it('throws when a DEGIRO annual report has no extractable rows', async () => {
    mockPdfDocument(degiroPage(
      'Visão geral da Carteira e dos Lucros/Perdas ' +
      'Dividendos E Outras Remunerações Ao Acionista em EUR País Produto Valor bruto Retenção na fonte Valor líquido ' +
      '0,00 EUR 0,00 EUR 0,00 EUR ' +
      'Transações Produto Ticker / ISIN Data Quant. Preço Valor Valor em EUR Tipo de Ordem Comissão Taxa de câmbio ' +
      'Não há transações para o ano reportado.'
    ));
    const file = new File([''], 'degiro-empty.pdf');

    await expect(parseDegiroAnnualPdf(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_pdf_no_rows',
    });
  });
});
