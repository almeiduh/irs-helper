import { describe, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { downloadXmlFile, processBrokerFiles, processTaxFiles } from './processFiles';
import { BrokerParsingError } from './parserErrors';
import { parseTradeRepublicPdf } from './pdfParsers/tradeRepublicParser';
import { parseTrading212Pdf } from './pdfParsers/trading212Parser';
import { parseActivoBankPdf } from './pdfParsers/activoBankParser';
import { resetEcbUsdEurRateCacheForTests } from './ecbFxRates';

const sampleCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00",,"74,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00","-1,00","73,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
02-10-2020,09:47,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,2,"54,0000",EUR,"-108,00",EUR,"-108,00",,"0,00",,"-108,00",,a5d2688d-38db-41cd-a9a0-681f778201d4
`;

const revolutCsv = `"Contas-correntes Resumos",,,,,,,,
"Investment Services Resumos",,,,,,,,
"Investment Services Extratos de operações",,,,,,,,
"Extrato de operações (apenas dividendos recebidos)",,,,,,,,
Data,"Descrição e símbolo",ISIN,País,"Dividendo/rendimento brutos","Impostos retidos","Outros impostos",Comissões,"Dividendo/lucro líquido",
17/02/2025,"Apple dividend",US0378331005,US,"0,48$ (0,44€)","0,07$ (0,06€)","0,00$ (0,00€)","0,00€ (0,00€)","0,41$ (0,38€)"
`;

const multiYearRevolutCsv = `"Contas-correntes Resumos",,,,,,,,
"Investment Services Resumos",,,,,,,,
"Investment Services Extratos de operações",,,,,,,,
"Extrato de operações (apenas dividendos recebidos)",,,,,,,,
Data,"Descrição e símbolo",ISIN,País,"Dividendo/rendimento brutos","Impostos retidos","Outros impostos",Comissões,"Dividendo/lucro líquido",
17/02/2024,"Apple dividend",US0378331005,US,"0,48$ (0,44€)","0,07$ (0,06€)","0,00$ (0,00€)","0,00€ (0,00€)","0,41$ (0,38€)"
17/02/2025,"Apple dividend",US0378331005,US,"0,60$ (0,55€)","0,09$ (0,08€)","0,00$ (0,00€)","0,00€ (0,00€)","0,51$ (0,47€)"
`;

vi.mock('./pdfParsers/xtbParser', () => ({
  parseXtbCapitalGainsPdf: vi.fn(),
  parseXtbDividendsPdf: vi.fn(),
}));
vi.mock('./pdfParsers/tradeRepublicParser', () => ({
  parseTradeRepublicPdf: vi.fn(),
}));
vi.mock('./pdfParsers/trading212Parser', () => ({
  parseTrading212Pdf: vi.fn(),
}));
vi.mock('./pdfParsers/activoBankParser', () => ({
  parseActivoBankPdf: vi.fn(),
}));
vi.mock('./pdfParsers/freedom24Parser', () => ({
  parseFreedom24Pdf: vi.fn(),
}));
vi.mock('./pdfParsers/ibkrParser', () => ({
  parseIbkrPdf: vi.fn(),
}));
vi.mock('./pdfParsers/revolutParser', () => ({
  parseRevolutConsolidatedPdf: vi.fn(),
}));

const ETRADE_HEADERS = [
  'Record Type',
  'Symbol',
  'Plan Type',
  'Quantity',
  'Date Acquired',
  'Date Acquired (Wash Sale Toggle = On)',
  'Acquisition Cost',
  'Acquisition Cost Per Share',
  'Ordinary Income Recognized',
  'Ordinary Income Recognized Per Share',
  'Adjusted Cost Basis',
  'Adjusted Cost Basis Per Share',
  'Date Sold',
  'Total Proceeds',
  'Proceeds Per Share',
  'Deferred Loss',
  'Gain/Loss',
  'Gain/Loss (Wash Sale Toggle = On)',
  'Adjusted Gain/Loss',
  'Adjusted Gain (Loss) Per Share',
  'Capital Gains Status',
  'Wash Sale Adjusted Capital Gains Status',
  'Total Wash Sale Adjustment Amount',
  'Wash Sale Adjustment Amount Per Share',
  'Total Wash Sale Adjusted Cost Basis',
  'Wash Sale Adjusted Cost Basis Per Share',
  'Total Wash Sale Adjusted Gain/Loss',
  'Wash Sale Adjusted Gain/Loss Per Share',
] as const;

function buildEtradeWorkbook(rows: Record<string, string | number>[]): File {
  const worksheet = utils.aoa_to_sheet([
    [...ETRADE_HEADERS],
    ...rows.map(row => ETRADE_HEADERS.map(header => row[header] ?? '')),
  ]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'G&L_Collapsed');
  const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new File([buffer], 'etrade.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const etradeEcbCsv = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-11-05,1.0900
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-12-05,1.0800
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-05,1.0694
`;

describe('processBrokerFiles', () => {
  it('includes E*TRADE rows in the broker aggregation flow', async () => {
    resetEcbUsdEurRateCacheForTests();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(etradeEcbCsv, { status: 200 })));

    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/03/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/03/2025',
        'Adjusted Cost Basis': 1000,
        'Date Sold': '03/05/2025',
        'Total Proceeds': 1200,
        'Adjusted Gain/Loss': 200,
      },
    ]);
    const result = await processBrokerFiles({ etradeGainLossXlsx });

    expect(result.parsedData.rows92A).toHaveLength(1);
    expect(result.parsedData.rows92A[0].codigo).toBe('G01');
    expect(result.sources.table92A).toEqual(['E*TRADE']);
  });

  it('includes DEGIRO rows in the broker aggregation flow', async () => {
    const degiroTransactionsCsv = new File([sampleCsv], 'degiro.csv', { type: 'text/csv' });
    const result = await processBrokerFiles({ degiroTransactionsCsv });

    expect(result.parsedData.rows92A).toHaveLength(1);
    expect(result.sources.table92A).toEqual(['DEGIRO']);
  });

  it('keeps DEGIRO rows from all years when no target year is supplied', async () => {
    const multiYearCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
15-02-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"60,0000",EUR,"-60,00",EUR,"-60,00",,"0,00","-0,50","-60,50",,buy-2
15-03-2025,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"90,0000",EUR,"90,00",EUR,"90,00",,"0,00","-1,00","89,00",,sell-2
`;
    const degiroTransactionsCsv = new File([multiYearCsv], 'degiro.csv', { type: 'text/csv' });
    const result = await processBrokerFiles({ degiroTransactionsCsv });

    expect(result.parsedData.rows92A).toHaveLength(2);
    expect(result.parsedData.rows92A.map(row => row.anoRealizacao)).toEqual(['2024', '2025']);
  });

  it('includes Revolut CSV rows in the broker aggregation flow', async () => {
    const result = await processBrokerFiles({
      revolutConsolidatedCsv: new File([revolutCsv], 'revolut.csv', { type: 'text/csv' }),
    });

    expect(result.parsedData.rows8A).toHaveLength(1);
    expect(result.parsedData.rows8A[0]._source).toBe('Revolut');
    expect(result.sources.table8A).toEqual(['Revolut']);
  });
});

describe('processTaxFiles', () => {
  it('infers the target transaction year from the XML model version for E*TRADE enrichment', async () => {
    resetEcbUsdEurRateCacheForTests();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(etradeEcbCsv, { status: 200 })));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2026>`;
    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '11/05/2024',
        'Date Acquired (Wash Sale Toggle = On)': '11/05/2024',
        'Adjusted Cost Basis': 109,
        'Date Sold': '12/05/2024',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 11,
      },
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/03/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/03/2025',
        'Adjusted Cost Basis': 1000,
        'Date Sold': '03/05/2025',
        'Total Proceeds': 1200,
        'Adjusted Gain/Loss': 200,
      },
    ]);

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      etradeGainLossXlsx,
    });

    expect(result.summary.table92A.rowsAdded).toBe(1);
    expect(result.summary.table92A.sources).toEqual(['E*TRADE']);
    expect(result.enrichedXml).toContain('<AnoRealizacao>2025</AnoRealizacao>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>2024</AnoRealizacao>');
  });

  it('does not block other broker rows when E*TRADE has no sells in the target year', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2025 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2025">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
      <AnexoJq08AT01/>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2025>`;
    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '11/05/2023',
        'Date Acquired (Wash Sale Toggle = On)': '11/05/2023',
        'Adjusted Cost Basis': 109,
        'Date Sold': '12/05/2023',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 11,
      },
    ]);

    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [{
        codigo: 'E11',
        codPais: '276',
        rendimentoBruto: '10.00',
        impostoPago: '0.00',
      }],
      rows92A: [],
      rows92B: [],
      rowsG9: [],
      rowsG13: [],
      rowsG18A: [],
      rowsG1q7: [],
      warnings: [],
    });

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf', { type: 'application/pdf' }),
      etradeGainLossXlsx,
    });

    expect(result.summary.table8A.rowsAdded).toBe(1);
    expect(result.summary.table8A.sources).toEqual(['Trade Republic']);
    expect(result.summary.table92A.rowsAdded).toBe(0);
    expect(result.enrichedXml).toContain('<CodRendimento>E11</CodRendimento>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>');
  });

  it('returns NO_ROWS_FOUND when E*TRADE is the only source and filtering leaves nothing', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2025 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2025">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2025>`;
    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '11/05/2023',
        'Date Acquired (Wash Sale Toggle = On)': '11/05/2023',
        'Adjusted Cost Basis': 109,
        'Date Sold': '12/05/2023',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 11,
      },
    ]);

    await expect(processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      etradeGainLossXlsx,
    })).rejects.toThrow('NO_ROWS_FOUND');
  });

  it('infers the target transaction year from the XML model version for DEGIRO enrichment', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2026>`;
    const multiYearCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
15-02-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"60,0000",EUR,"-60,00",EUR,"-60,00",,"0,00","-0,50","-60,50",,buy-2
15-03-2025,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"90,0000",EUR,"90,00",EUR,"90,00",,"0,00","-1,00","89,00",,sell-2
`;

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      degiroTransactionsCsv: new File([multiYearCsv], 'degiro.csv', { type: 'text/csv' }),
    });

    expect(result.summary.table92A.rowsAdded).toBe(1);
    expect(result.summary.table92A.sources).toEqual(['DEGIRO']);
    expect(result.enrichedXml).toContain('<AnoRealizacao>2025</AnoRealizacao>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>2024</AnoRealizacao>');
  });

  it('surfaces incomplete history when the target year depends on an ISIN with a prior oversell', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2024 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2024">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2024>`;
    const csv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
10-01-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"25,0000",EUR,"-25,00",EUR,"-25,00",,"0,00","-0,50","-25,50",,buy-old
10-02-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-2,"30,0000",EUR,"60,00",EUR,"60,00",,"0,00","-1,00","59,00",,sell-old
10-03-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"55,0000",EUR,"55,00",EUR,"55,00",,"0,00","-1,00","54,00",,sell-new
`;

    await expect(processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      degiroTransactionsCsv: new File([csv], 'degiro.csv', { type: 'text/csv' }),
    })).rejects.toThrow(BrokerParsingError);
    await expect(processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      degiroTransactionsCsv: new File([csv], 'degiro.csv', { type: 'text/csv' }),
    })).rejects.toMatchObject({
      i18nKey: 'parser.error.degiro_incomplete_history',
    });
  });

  it('does not block other broker rows when DEGIRO has no sells in the target year', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2025 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2025">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
      <AnexoJq08AT01/>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2025>`;
    const degiroCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
`;

    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [{
        codigo: 'E11',
        codPais: '276',
        rendimentoBruto: '10.00',
        impostoPago: '0.00',
      }],
      rows92A: [],
      rows92B: [],
      rowsG9: [],
      rowsG13: [],
      rowsG18A: [],
      rowsG1q7: [],
      warnings: [],
    });

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf', { type: 'application/pdf' }),
      degiroTransactionsCsv: new File([degiroCsv], 'degiro.csv', { type: 'text/csv' }),
    });

    expect(result.summary.table8A.rowsAdded).toBe(1);
    expect(result.summary.table8A.sources).toEqual(['Trade Republic']);
    expect(result.summary.table92A.rowsAdded).toBe(0);
    expect(result.enrichedXml).toContain('<CodRendimento>E11</CodRendimento>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>');
  });

  it('returns NO_ROWS_FOUND when DEGIRO is the only source and filtering leaves nothing', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2025 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2025">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2025>`;
    const degiroCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2023,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
`;

    await expect(processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      degiroTransactionsCsv: new File([degiroCsv], 'degiro.csv', { type: 'text/csv' }),
    })).rejects.toThrow('NO_ROWS_FOUND');
  });

  it('infers the target year for Revolut CSV enrichment', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08>
      <AnexoJq08AT01/>
      <AnexoJq08AT01SomaC01>0.00</AnexoJq08AT01SomaC01>
      <AnexoJq08AT01SomaC02>0.00</AnexoJq08AT01SomaC02>
    </Quadro08>
    <Quadro09/>
  </AnexoJ>
</Modelo3IRSv2026>`;

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      revolutConsolidatedCsv: new File([multiYearRevolutCsv], 'revolut.csv', { type: 'text/csv' }),
    });

    expect(result.summary.table8A.rowsAdded).toBe(1);
    expect(result.summary.table8A.sources).toEqual(['Revolut']);
    expect(result.enrichedXml).toContain('<RendimentoBruto>0.55</RendimentoBruto>');
    expect(result.enrichedXml).not.toContain('<RendimentoBruto>0.44</RendimentoBruto>');
  });

  it('merges multiple broker sources and tracks them in summary', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2025 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2025">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
      <AnexoJq08AT01/>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2025>`;

    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [{ codigo: 'E21', codPais: '276', rendimentoBruto: '10.00', impostoPago: '0.00' }],
      rows92A: [], rows92B: [], rowsG9: [], rowsG13: [], rowsG18A: [], rowsG1q7: [], warnings: [],
    });
    vi.mocked(parseTrading212Pdf).mockResolvedValueOnce({
      rows8A: [{ codigo: 'E11', codPais: '840', rendimentoBruto: '5.00', impostoPago: '1.00' }],
      rows92A: [], rows92B: [], rowsG9: [], rowsG13: [], rowsG18A: [], rowsG1q7: [], warnings: [],
    });

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf', { type: 'application/pdf' }),
      trading212Pdf: new File(['dummy'], 't212.pdf', { type: 'application/pdf' }),
    });

    expect(result.summary.table8A.rowsAdded).toBe(2);
    expect(result.summary.table8A.sources).toContain('Trade Republic');
    expect(result.summary.table8A.sources).toContain('Trading 212');
    expect(result.summary.totalRowsAdded).toBe(2);
  });
});

describe('processBrokerFiles – multi-broker', () => {
  it('aggregates multiple broker sources and stamps _source on rows', async () => {
    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [{ codigo: 'E21', codPais: '276', rendimentoBruto: '10.00', impostoPago: '0.00' }],
      rows92A: [], rows92B: [], rowsG9: [], rowsG13: [], rowsG18A: [], rowsG1q7: [], warnings: [],
    });
    vi.mocked(parseTrading212Pdf).mockResolvedValueOnce({
      rows8A: [{ codigo: 'E11', codPais: '840', rendimentoBruto: '5.00', impostoPago: '1.00' }],
      rows92A: [], rows92B: [], rowsG9: [], rowsG13: [], rowsG18A: [], rowsG1q7: [], warnings: [],
    });

    const result = await processBrokerFiles({
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf', { type: 'application/pdf' }),
      trading212Pdf: new File(['dummy'], 't212.pdf', { type: 'application/pdf' }),
    });

    expect(result.parsedData.rows8A).toHaveLength(2);
    expect(result.parsedData.rows8A[0]._source).toBe('Trade Republic');
    expect(result.parsedData.rows8A[1]._source).toBe('Trading 212');
    expect(result.sources.table8A).toContain('Trade Republic');
    expect(result.sources.table8A).toContain('Trading 212');
  });
});

describe('downloadXmlFile', () => {
  it('creates a blob, triggers download, and revokes URL', () => {
    const mockClick = vi.fn();
    const mockAppendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
    const mockRemoveChild = vi.spyOn(document.body, 'removeChild').mockImplementation(node => node);
    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(_: string) {},
      set download(_: string) {},
      click: mockClick,
    } as unknown as HTMLAnchorElement);

    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    downloadXmlFile('<xml/>', 'test.xml');

    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    mockAppendChild.mockRestore();
    mockRemoveChild.mockRestore();
  });
});

describe('processBrokerFiles – row type coverage', () => {
  it('merges rows92B, rowsG9, rowsG13, rowsG18A, rowsG1q7, and warnings', async () => {
    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [],
      rows92A: [],
      rows92B: [{ codigo: 'G98', codPais: '840', rendimentoLiquido: '25.00', impostoPagoNoEstrangeiro: '0.00', codPaisContraparte: '840' }],
      rowsG9: [],
      rowsG13: [{ codigoOperacao: 'G51', titular: 'A', rendimentoLiquido: '-10.00', paisContraparte: '840' }],
      rowsG18A: [{ titular: 'A', codPaisEntGestora: '250', anoRealizacao: '2025', mesRealizacao: '6', diaRealizacao: '1', valorRealizacao: '500.00', anoAquisicao: '2025', mesAquisicao: '1', diaAquisicao: '15', valorAquisicao: '400.00', despesasEncargos: '2.00', codPaisContraparte: '250' }],
      rowsG1q7: [{ titular: 'A', codPaisEntGestora: '250', anoRealizacao: '2025', mesRealizacao: '6', diaRealizacao: '1', valorRealizacao: '300.00', anoAquisicao: '2023', mesAquisicao: '1', diaAquisicao: '15', valorAquisicao: '200.00', despesasEncargos: '1.00', codPaisContraparte: '250' }],
      warnings: ['test_warning'],
    });

    vi.mocked(parseActivoBankPdf).mockResolvedValueOnce({
      rows8A: [],
      rows92A: [],
      rows92B: [],
      rowsG9: [{ titular: 'A', nif: '500734305', codEncargos: 'G01', anoRealizacao: '2025', mesRealizacao: '6', diaRealizacao: '16', valorRealizacao: '1058.40', anoAquisicao: '2024', mesAquisicao: '6', diaAquisicao: '26', valorAquisicao: '1040.40', despesasEncargos: '5.00', paisContraparte: '840' }],
      rowsG13: [],
      rowsG18A: [],
      rowsG1q7: [],
      warnings: [],
    });

    const result = await processBrokerFiles({
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf'),
      activoBankPdf: new File(['dummy'], 'ab.pdf'),
    });

    expect(result.parsedData.rows92B).toHaveLength(1);
    expect(result.parsedData.rows92B[0]._source).toBe('Trade Republic');
    expect(result.parsedData.rowsG9).toHaveLength(1);
    expect(result.parsedData.rowsG9[0]._source).toBe('ActivoBank');
    expect(result.parsedData.rowsG13).toHaveLength(1);
    expect(result.parsedData.rowsG18A).toHaveLength(1);
    expect(result.parsedData.rowsG1q7).toHaveLength(1);
    expect(result.warnings).toEqual(['test_warning']);
    expect(result.sources.table92B).toContain('Trade Republic');
    expect(result.sources.tableG9).toContain('ActivoBank');
    expect(result.sources.tableG13).toContain('Trade Republic');
    expect(result.sources.tableG18A).toContain('Trade Republic');
    expect(result.sources.tableG1q7).toContain('Trade Republic');
  });

  it('throws NO_ROWS_FOUND when no broker files are provided', async () => {
    await expect(processBrokerFiles({})).rejects.toThrow('NO_ROWS_FOUND');
  });

  it('does not throw when warnings are returned but no data rows', async () => {
    vi.mocked(parseTradeRepublicPdf).mockResolvedValueOnce({
      rows8A: [], rows92A: [], rows92B: [], rowsG9: [], rowsG13: [],
      rowsG18A: [], rowsG1q7: [],
      warnings: ['parser.error.binance_no_sells'],
    });

    const result = await processBrokerFiles({
      tradeRepublicPdf: new File(['dummy'], 'tr.pdf'),
    });

    expect(result.warnings).toEqual(['parser.error.binance_no_sells']);
    expect(result.parsedData.rows8A).toHaveLength(0);
  });
});
