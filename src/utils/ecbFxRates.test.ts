import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ECB_USD_EUR_CACHE_STORAGE_KEY, getUsdEurRatesForDates, resetEcbUsdEurRateCacheForTests } from './ecbFxRates';

function createStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK,OBS_COM,TIME_FORMAT,BREAKS,COLLECTION,COMPILING_ORG,DISS_ORG,DOM_SER_IDS,PUBL_ECB,PUBL_MU,PUBL_PUBLIC,UNIT_INDEX_BASE,COMPILATION,COVERAGE,DECIMALS,NAT_TITLE,SOURCE_AGENCY,SOURCE_PUB,TITLE,TITLE_COMPL,UNIT,UNIT_MULT
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465,A,F,,,P1D,,A,,,,,,,99Q1=100,,,4,,4F0,,US dollar/Euro ECB reference exchange rate,"ECB reference exchange rate, US dollar/Euro, 2.15 pm (C.E.T.)",USD,0
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-04,1.0557,A,F,,,P1D,,A,,,,,,,99Q1=100,,,4,,4F0,,US dollar/Euro ECB reference exchange rate,"ECB reference exchange rate, US dollar/Euro, 2.15 pm (C.E.T.)",USD,0
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-05,1.0694,A,F,,,P1D,,A,,,,,,,99Q1=100,,,4,,4F0,,US dollar/Euro ECB reference exchange rate,"ECB reference exchange rate, US dollar/Euro, 2.15 pm (C.E.T.)",USD,0
`;

describe('ecbFxRates', () => {
  beforeEach(() => {
    resetEcbUsdEurRateCacheForTests();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorageMock(),
    });
  });

  it('reuses in-memory cached rates without refetching the same dates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(ECB_CSV, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getUsdEurRatesForDates(['2025-03-03', '2025-03-04']);
    const second = await getUsdEurRatesForDates(['2025-03-03', '2025-03-04']);

    expect(first['2025-03-03']).toBe(1.0465);
    expect(second['2025-03-04']).toBe(1.0557);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches only missing overlapping dates and merges them into cache', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(ECB_CSV.split('\n').slice(0, 3).join('\n'), { status: 200 }))
      .mockResolvedValueOnce(new Response([ECB_CSV.split('\n')[0], ECB_CSV.split('\n')[3], ''].join('\n'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getUsdEurRatesForDates(['2025-03-03', '2025-03-04']);
    const rates = await getUsdEurRatesForDates(['2025-03-04', '2025-03-05']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('startPeriod=2025-03-05');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('endPeriod=2025-03-12');
    expect(rates['2025-03-04']).toBe(1.0557);
    expect(rates['2025-03-05']).toBe(1.0694);
  });

  it('loads persisted cached rates from localStorage before falling back to network', async () => {
    globalThis.localStorage.setItem(
      ECB_USD_EUR_CACHE_STORAGE_KEY,
      JSON.stringify({ '2025-03-03': 1.0465, '2025-03-04': 1.0557 }),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const rates = await getUsdEurRatesForDates(['2025-03-03', '2025-03-04']);

    expect(rates['2025-03-03']).toBe(1.0465);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls forward to the next published ECB day when the exact date has no rate', async () => {
    const csvWithoutWeekend = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csvWithoutWeekend, { status: 200 })));

    const rates = await getUsdEurRatesForDates(['2025-03-01']);

    expect(rates['2025-03-01']).toBe(1.0465);
  });

  it('uses persisted resolved dates to satisfy later weekend lookups without refetching', async () => {
    globalThis.localStorage.setItem(
      ECB_USD_EUR_CACHE_STORAGE_KEY,
      JSON.stringify({ '2025-03-01': 1.0465 }),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const rates = await getUsdEurRatesForDates(['2025-03-01']);

    expect(rates['2025-03-01']).toBe(1.0465);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the lookahead window before using a later cached published date', async () => {
    globalThis.localStorage.setItem(
      ECB_USD_EUR_CACHE_STORAGE_KEY,
      JSON.stringify({ '2025-03-07': 1.2000 }),
    );

    const csvWithEarlierNextPublishedDate = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(csvWithEarlierNextPublishedDate, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const rates = await getUsdEurRatesForDates(['2025-03-01']);

    expect(rates['2025-03-01']).toBe(1.0465);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not use a far-future cached rate as the next published ECB day', async () => {
    globalThis.localStorage.setItem(
      ECB_USD_EUR_CACHE_STORAGE_KEY,
      JSON.stringify({ '2025-12-31': 1.2000 }),
    );

    const emptyCsv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n';
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(emptyCsv, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getUsdEurRatesForDates(['2025-03-01'])).rejects.toThrow('2025-03-01');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fails when no next published ECB day can be found', async () => {
    const emptyCsv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(emptyCsv, { status: 200 }))));

    await expect(getUsdEurRatesForDates(['2025-03-04'])).rejects.toThrow('2025-03-04');
  });
});
