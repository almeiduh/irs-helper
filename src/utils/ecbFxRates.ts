const ECB_API_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A';
export const ECB_USD_EUR_CACHE_STORAGE_KEY = 'irs-helper-ecb-usd-eur-rates-v1';
const NEXT_PUBLISHED_DAY_LOOKAHEAD_DAYS = 7;

type EcbRateCache = Record<string, number>;

let memoryCache = new Map<string, number>();
let hydratedFromStorage = false;

export class EcbFxError extends Error {
  public readonly code: 'download_failed' | 'missing_rate' | 'invalid_response';
  public readonly date?: string;

  constructor(message: string, code: EcbFxError['code'], date?: string) {
    super(message);
    this.name = 'EcbFxError';
    this.code = code;
    this.date = date;
  }
}

function getStorage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') {
      return undefined;
    }
    return localStorage;
  } catch {
    return undefined;
  }
}

function hydrateFromPersistentCache(): void {
  if (hydratedFromStorage) {
    return;
  }

  hydratedFromStorage = true;
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const raw = storage.getItem(ECB_USD_EUR_CACHE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as EcbRateCache;
    for (const [date, rate] of Object.entries(parsed)) {
      if (Number.isFinite(rate)) {
        memoryCache.set(date, rate);
      }
    }
  } catch {
    storage.removeItem(ECB_USD_EUR_CACHE_STORAGE_KEY);
  }
}

function persistCache(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const serializable: EcbRateCache = {};
  for (const [date, rate] of [...memoryCache.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    serializable[date] = rate;
  }

  storage.setItem(ECB_USD_EUR_CACHE_STORAGE_KEY, JSON.stringify(serializable));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    if (char !== '\r') {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter(row => row.some(value => value.trim() !== ''));
}

function parseEcbCsv(csvText: string): Map<string, number> {
  const rows = parseCsv(csvText);
  const [headers, ...dataRows] = rows;

  if (!headers) {
    throw new EcbFxError('ECB response did not contain headers.', 'invalid_response');
  }

  const timePeriodIndex = headers.indexOf('TIME_PERIOD');
  const obsValueIndex = headers.indexOf('OBS_VALUE');
  if (timePeriodIndex === -1 || obsValueIndex === -1) {
    throw new EcbFxError('ECB response is missing required columns.', 'invalid_response');
  }

  const parsed = new Map<string, number>();
  for (const row of dataRows) {
    const date = (row[timePeriodIndex] ?? '').trim();
    const value = Number.parseFloat((row[obsValueIndex] ?? '').trim());
    if (date && Number.isFinite(value)) {
      parsed.set(date, value);
    }
  }

  return parsed;
}

function buildFetchUrl(startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    startPeriod: startDate,
    endPeriod: endDate,
    format: 'csvdata',
  });

  return `${ECB_API_URL}?${params.toString()}`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function findSameOrNextPublishedRate(date: string): number | undefined {
  const exactRate = memoryCache.get(date);
  if (exactRate !== undefined) {
    return exactRate;
  }

  const lastAcceptableDate = addDays(date, NEXT_PUBLISHED_DAY_LOOKAHEAD_DAYS);
  const sortedDates = [...memoryCache.keys()].sort();
  const nextDate = sortedDates.find(candidate => candidate > date && candidate <= lastAcceptableDate);
  return nextDate ? memoryCache.get(nextDate) : undefined;
}

async function fetchMissingRange(startDate: string, endDate: string): Promise<void> {
  const response = await fetch(buildFetchUrl(startDate, endDate));
  if (!response.ok) {
    throw new EcbFxError(`Failed to download ECB USD/EUR rates (${response.status}).`, 'download_failed');
  }

  const body = await response.text();
  const fetchedRates = parseEcbCsv(body);
  for (const [date, rate] of fetchedRates.entries()) {
    memoryCache.set(date, rate);
  }

  persistCache();
}

export async function getUsdEurRatesForDates(dates: string[]): Promise<Record<string, number>> {
  hydrateFromPersistentCache();

  const requiredDates = [...new Set(dates.filter(Boolean))].sort();
  if (requiredDates.length === 0) {
    return {};
  }

  const missingExactDates = requiredDates.filter(date => !memoryCache.has(date));
  if (missingExactDates.length > 0) {
    await fetchMissingRange(
      missingExactDates[0],
      addDays(missingExactDates[missingExactDates.length - 1], NEXT_PUBLISHED_DAY_LOOKAHEAD_DAYS),
    );
  }

  const resolvedRates: Record<string, number> = {};
  for (const date of requiredDates) {
    let rate = findSameOrNextPublishedRate(date);
    if (rate === undefined) {
      await fetchMissingRange(date, addDays(date, NEXT_PUBLISHED_DAY_LOOKAHEAD_DAYS));
      rate = findSameOrNextPublishedRate(date);
    }

    if (rate === undefined) {
      throw new EcbFxError(`Missing ECB USD/EUR rate for ${date} and the next published ECB day.`, 'missing_rate', date);
    }
    resolvedRates[date] = rate;
  }

  return resolvedRates;
}

export function convertUsdAmountToEur(amountUsd: number, usdPerEurRate: number): number {
  return amountUsd / usdPerEurRate;
}

export function resetEcbUsdEurRateCacheForTests(): void {
  memoryCache = new Map<string, number>();
  hydratedFromStorage = false;
  getStorage()?.removeItem(ECB_USD_EUR_CACHE_STORAGE_KEY);
}
