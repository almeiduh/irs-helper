import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { parseEtradeGainLossWorkbook } from './etradeXlsxParser';
import { BrokerParsingError } from '../parserErrors';
import { resetEcbUsdEurRateCacheForTests } from '../ecbFxRates';

const HEADERS = [
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

function buildWorkbook(rows: Record<string, string | number>[]): File {
  const sheetRows = [
    [...HEADERS],
    ...rows.map(row => HEADERS.map(header => row[header] ?? '')),
  ];
  const worksheet = utils.aoa_to_sheet(sheetRows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'G&L_Collapsed');
  const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new File([buffer], 'etrade.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-05,1.0694
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-11-05,1.0900
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-12-05,1.0800
`;

describe('parseEtradeGainLossWorkbook', () => {
  beforeEach(() => {
    resetEcbUsdEurRateCacheForTests();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  it('extracts 9.2A rows from Sell records and converts USD values into EUR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ECB_CSV, { status: 200 })));
    const file = buildWorkbook([
      {
        'Record Type': 'Summary',
        Symbol: '762',
        Quantity: 1,
      },
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 10,
        'Date Acquired': '03/03/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/03/2025',
        'Acquisition Cost': 0,
        'Adjusted Cost Basis': 1000,
        'Adjusted Cost Basis Per Share': 100,
        'Date Sold': '03/05/2025',
        'Total Proceeds': 1200,
        'Proceeds Per Share': 120,
        'Gain/Loss': 200,
        'Gain/Loss (Wash Sale Toggle = On)': 200,
        'Adjusted Gain/Loss': 200,
        'Adjusted Gain (Loss) Per Share': 20,
        'Capital Gains Status': 'Short Term',
        'Wash Sale Adjusted Capital Gains Status': 'Short Term',
      },
    ]);

    const data = await parseEtradeGainLossWorkbook(file);

    expect(data.rows92A).toEqual([{
      codPais: '840',
      codigo: 'G01',
      anoRealizacao: '2025',
      mesRealizacao: '3',
      diaRealizacao: '5',
      valorRealizacao: '1122.12',
      anoAquisicao: '2025',
      mesAquisicao: '3',
      diaAquisicao: '3',
      valorAquisicao: '955.57',
      despesasEncargos: '0.00',
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: '620',
    }]);
  });

  it('filters to the requested realization year while retaining older acquisition dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ECB_CSV, { status: 200 })));
    const file = buildWorkbook([
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

    const data = await parseEtradeGainLossWorkbook(file, { targetRealizationYear: '2025' });

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].anoRealizacao).toBe('2025');
  });

  it('returns empty data when the requested realization year has no matching sells', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = buildWorkbook([
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

    const data = await parseEtradeGainLossWorkbook(file, { targetRealizationYear: '2025' });

    expect(data.rows92A).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the workbook is missing required headers', async () => {
    const worksheet = utils.aoa_to_sheet([['Date', 'Symbol', 'Value']]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const file = new File([buffer], 'wrong.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseEtradeGainLossWorkbook(file)).rejects.toThrow(BrokerParsingError);
    await expect(parseEtradeGainLossWorkbook(file)).rejects.toMatchObject({
      i18nKey: 'parser.error.etrade_wrong_file',
    });
  });

  it('uses the next published ECB day when the workbook date has no exact rate', async () => {
    const csvWithNextPublishedDate = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csvWithNextPublishedDate, { status: 200 })));
    const file = buildWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/01/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/01/2025',
        'Adjusted Cost Basis': 100,
        'Date Sold': '03/03/2025',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 20,
      },
    ]);

    const data = await parseEtradeGainLossWorkbook(file);

    expect(data.rows92A).toHaveLength(1);
    expect(data.rows92A[0].valorAquisicao).toBe('95.56');
  });

  it('fails when no next published ECB day is available for a workbook date', async () => {
    const csvWithoutWeekend = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
`;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(csvWithoutWeekend, { status: 200 }))));
    const file = buildWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/01/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/01/2025',
        'Adjusted Cost Basis': 100,
        'Date Sold': '03/03/2025',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 20,
      },
    ]);

    const result = parseEtradeGainLossWorkbook(file);

    await expect(result).rejects.toThrow(BrokerParsingError);
    await expect(result).rejects.toMatchObject({
      i18nKey: 'parser.error.etrade_missing_fx_rate',
    });
  });
});
