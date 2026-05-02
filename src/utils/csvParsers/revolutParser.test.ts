import { describe, expect, it } from 'vitest';
import { parseRevolutConsolidatedCsv } from './revolutParser';

const revolut2025Csv = `"Contas-correntes Resumos",,,,,,,,
"Savings Accounts Transaction Statements",,,,,,,,
"Poupança de Acesso Imediato  (EUR)",,,,,,,,
"Transaction statement (only interest receipt)",,,,,,,,
Data,Descrição,TAE,TANB,"Gross interest","Taxes withheld","Other taxes",Fees,"Net interest"
22/11/25,"Pagamento de juros para subconta ""Instant Access Savings"" relativos a 22/11/2025","1.76%","1.75%","0,43€","0,12€","0,00€","0,00€","0,31€"
Total,,,,"0,43€","0,12€","0,00€","0,00€","0,31€"
---------,,,,,,,,
"Fundos Monetários Flexíveis Extratos de operações",,,,,,,,
"Fundos Monetários Flexíveis  (EUR)",,,,,,,,
"Transaction statement (only returns)",,,,,,,,
Data,Descrição,"Juros líquidos","Imposto retido","Outros impostos","Comissões de serviço","Juros líquidos distribuídos e levantados",,
12/11/2025,"Interest earned - Flexible Cash Funds","0,28€","0,00€","0,00€","0,04€","0,24€",,
13/11/2025,"Interest earned - Flexible Cash Funds","0,29€","0,01€","0,02€","0,04€","0,22€",,
Total,,"0,57€","0,01€","0,02€","0,08€","0,46€",,
---------,,,,,,,,
"Cripto Extratos de operações",,,,,,,,
"Extrato de operação (apenas vendas)",,,,,,,,
"Data (da venda, da compra)","Descrição e símbolo","Idade das unidades","Unidades vendidas","Preço unitário (Data de venda, na Data de compra)","Valor (da venda, da compra)","Ganhos de capital",Comissões,
"27.09.25, 27.09.25",ZKJ,"0 days","0,88975577","+ 0,11€, - 0,00€","+ 0,10€, - 0,00€","0,10€","0,06€",
Total,,,,,"+ 0,10€, - 0,00€","0,10€","0,06€",
"Extrato de operação (apenas aquisições através de Learn & Earn)",,,,,,,,
"Data do recibo","Descrição e símbolo","Unidades recebidas","Preço unitário","Valor recebido",Comissões,,,
27.09.25,ZKJ,"0,88975577","0,11€","0,10€","0,00€",,,
Total,,,,"0,10€","0,00€",,,`;

const revolut2024Csv = `"Contas-correntes Resumos",,,,,,,,,,
"Investment Services Resumos",,,,,,,,,,
"Investment Services Extratos de operações",,,,,,,,,,
"Extrato de operações (apenas dividendos recebidos)",,,,,,,,,,
Data,"Descrição e símbolo",ISIN,País,"Dividendo/rendimento brutos","Impostos retidos","Outros impostos",Comissões,"Dividendo/lucro líquido",,
17/02/2024,"Apple dividend",US0378331005,US,"0,48$ (0,44€)","0,07$ (0,06€)","0,00$ (0,00€)","0,00€ (0,00€)","0,41$ (0,38€)",,
,,,,,,,,,,
"Unidades que foram vendidas",,,,,,,,,,
"Data (da venda, da compra)","Descrição, símbolo e ISIN",País,"Idade das unidades","Units sold","Preço unitário (Data de venda, na Data de compra)","Valor (da venda, da compra)","Ganhos de capital","Impostos retidos","Outros impostos",Comissões
"08/04/2024, 05/06/2020","Apple AAPL (US0378331005)",US,"1403 days",2,"+US$168.60, -US$82.71 (+€155.22, -€73.27)","+US$337.21, -US$165.42 (+€310.44, -€146.54)","US$171.79 (€163.90)","US$0 (€0)","US$0.02 (€0.01)","US$0 (€0)"
---------,,,,,,,,,,
"Cripto Extratos de operações",,,,,,,,,,
"Extrato de operação (apenas vendas)",,,,,,,,,,
"Data (da venda, da compra)","Descrição e símbolo","Idade das unidades","Unidades vendidas","Preço unitário (Data de venda, na Data de compra)","Valor (da venda, da compra)","Ganhos de capital",Comissões,,,
"22.08.24, 18.09.22",ETH,"1 year 11 months 4 days","0,01177332","+ 2 340,89€, - 1 419,31€","+ 27,56€, - 16,71€","10,85€","0,50€",,,
"22.08.24, 23.01.24",ETH,"6 months 30 days","0,085","+ 2 340,82€, - 2 081,06€","+ 198,97€, - 176,89€","22,08€","1,98€",,,
Total,,,,,"+ 226,53€, - 193,60€","32,93€","2,48€",,,`;

const revolut2023Csv = `"Contas-correntes Resumos",,,,,,,,,,
"Investment Services Resumos",,,,,,,,,,
"Investment Services Extratos de operações",,,,,,,,,,
"Extrato de operações (apenas dividendos recebidos)",,,,,,,,,,
Data,"Descrição e símbolo",ISIN,País,"Dividendo/rendimento brutos","Impostos retidos","Outros impostos",Comissões,"Dividendo/lucro líquido",,
17/02/2023,"Apple dividend",US0378331005,US,"0,46$ (0,43€)","0,07$ (0,06€)","0,00$ (0,00€)","0,00€ (0,00€)","0,39$ (0,36€)",,
19/05/2023,"Apple dividend",US0378331005,US,"0,48$ (0,44€)","0,07$ (0,06€)","0,00$ (0,00€)","0,00€ (0,00€)","0,41$ (0,37€)",,
,,,,,,,,,,
"Cripto Extratos de operações",,,,,,,,,,
"Extrato de operação (apenas vendas)",,,,,,,,,,
"Data (da venda, da compra)","Descrição e símbolo","Idade das unidades","Unidades vendidas","Preço unitário (Data de venda, na Data de compra)","Valor (da venda, da compra)","Ganhos de capital",Comissões,,,
"27.06.23, 27.06.23",1INCH,"0 days","1,69026119","+ 0,30€, - 0,00€","+ 0,50€, - 0,00€","0,50€","0,00€",,,
Total,,,,,"+ 0,50€, - 0,00€","0,50€","0,00€",,,`;

describe('parseRevolutConsolidatedCsv', () => {
  it('throws when the CSV is not a Revolut consolidated statement', async () => {
    const file = new File(['Data,Value\n2025-01-01,1'], 'other.csv', { type: 'text/csv' });

    await expect(parseRevolutConsolidatedCsv(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.revolut_wrong_file',
    });
  });

  it('parses 2025 Flexible Cash Funds interest and crypto sales while skipping Instant Access Savings', async () => {
    const file = new File([revolut2025Csv], 'revolut-2025.csv', { type: 'text/csv' });
    const data = await parseRevolutConsolidatedCsv(file);

    expect(data.rows8A).toEqual([{
      codigo: 'E21',
      codPais: '372',
      rendimentoBruto: '0.57',
      impostoPago: '0.03',
    }]);
    expect(data.rowsG18A).toEqual([{
      titular: 'A',
      codPaisEntGestora: '196',
      anoRealizacao: '2025',
      mesRealizacao: '9',
      diaRealizacao: '27',
      valorRealizacao: '0.10',
      anoAquisicao: '2025',
      mesAquisicao: '9',
      diaAquisicao: '27',
      valorAquisicao: '0.00',
      despesasEncargos: '0.06',
      codPaisContraparte: '196',
    }]);
    expect(data.rowsG1q7).toEqual([]);
  });

  it('parses 2024 investment dividends, investment sales, and crypto holding-period split', async () => {
    const file = new File([revolut2024Csv], 'revolut-2024.csv', { type: 'text/csv' });
    const data = await parseRevolutConsolidatedCsv(file);

    expect(data.rows8A).toEqual([{
      codigo: 'E11',
      codPais: '840',
      rendimentoBruto: '0.44',
      impostoPago: '0.06',
    }]);
    expect(data.rows92A).toEqual([{
      codPais: '840',
      codigo: 'G01',
      anoRealizacao: '2024',
      mesRealizacao: '4',
      diaRealizacao: '8',
      valorRealizacao: '310.44',
      anoAquisicao: '2020',
      mesAquisicao: '6',
      diaAquisicao: '5',
      valorAquisicao: '146.54',
      despesasEncargos: '0.01',
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: '840',
    }]);
    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].valorRealizacao).toBe('198.97');
    expect(data.rowsG1q7).toHaveLength(1);
    expect(data.rowsG1q7[0].valorRealizacao).toBe('27.56');
  });

  it('parses 2023 dividends and same-day crypto sales', async () => {
    const file = new File([revolut2023Csv], 'revolut-2023.csv', { type: 'text/csv' });
    const data = await parseRevolutConsolidatedCsv(file);

    expect(data.rows8A).toHaveLength(2);
    expect(data.rows8A.map(row => row.rendimentoBruto)).toEqual(['0.43', '0.44']);
    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].anoRealizacao).toBe('2023');
    expect(data.rowsG18A[0].valorRealizacao).toBe('0.50');
  });

  it('filters all generated rows by target realization year when supplied', async () => {
    const combinedCsv = `${revolut2024Csv}\n${revolut2025Csv}`;
    const file = new File([combinedCsv], 'revolut.csv', { type: 'text/csv' });
    const data = await parseRevolutConsolidatedCsv(file, { targetRealizationYear: '2025' });

    expect(data.rows8A).toHaveLength(1);
    expect(data.rows8A[0].rendimentoBruto).toBe('0.57');
    expect(data.rows92A).toEqual([]);
    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].anoRealizacao).toBe('2025');
    expect(data.rowsG1q7).toEqual([]);
  });
});
