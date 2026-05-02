import { parseXtbCapitalGainsPdf, parseXtbDividendsPdf } from './pdfParsers/xtbParser';
import { parseTradeRepublicPdf } from './pdfParsers/tradeRepublicParser';
import { parseTrading212Pdf } from './pdfParsers/trading212Parser';
import { parseActivoBankPdf } from './pdfParsers/activoBankParser';
import { parseFreedom24Pdf } from './pdfParsers/freedom24Parser';
import { parseIbkrPdf } from './pdfParsers/ibkrParser';
import { parseRevolutConsolidatedPdf } from './pdfParsers/revolutParser';
import { parseDegiroTransactionsCsv } from './csvParsers/degiroParser';
import { parseBinanceTransactionsXlsx } from './xlsxParsers/binanceParser';
import { parseEtradeGainLossWorkbook } from './xlsxParsers/etradeXlsxParser';
import { enrichXmlWithGains } from './xmlModifier';
import type { BrokerName, EnrichmentResult, ParsedPdfData } from '../types';

export const NO_ROWS_FOUND_ERROR = 'NO_ROWS_FOUND';

export interface ProcessTaxFilesInput {
  xmlFile: File;
  xtbCapitalGainsPdf?: File | null;
  xtbDividendsPdf?: File | null;
  tradeRepublicPdf?: File | null;
  trading212Pdf?: File | null;
  activoBankPdf?: File | null;
  freedom24Pdf?: File | null;
  ibkrPdf?: File | null;
  degiroTransactionsCsv?: File | null;
  binanceTransactionsXlsx?: File | null;
  revolutConsolidatedPdf?: File | null;
  etradeGainLossXlsx?: File | null;
}

export interface ProcessBrokerFilesInput {
  xtbCapitalGainsPdf?: File | null;
  xtbDividendsPdf?: File | null;
  tradeRepublicPdf?: File | null;
  trading212Pdf?: File | null;
  activoBankPdf?: File | null;
  freedom24Pdf?: File | null;
  ibkrPdf?: File | null;
  degiroTransactionsCsv?: File | null;
  binanceTransactionsXlsx?: File | null;
  revolutConsolidatedPdf?: File | null;
  etradeGainLossXlsx?: File | null;
}

export interface BrokerFilesResult {
  parsedData: ParsedPdfData;
  sources: {
    table8A: string[];
    table92A: string[];
    table92B: string[];
    tableG9: string[];
    tableG13: string[];
    tableG18A: string[];
    tableG1q7: string[];
  };
  warnings: string[];
}

interface ParseJob {
  file: File | null | undefined;
  parser: (file: File) => Promise<ParsedPdfData>;
  brokerName: BrokerName;
}

interface AggregatedSources {
  table8A: Set<BrokerName>;
  table92A: Set<BrokerName>;
  table92B: Set<BrokerName>;
  tableG9: Set<BrokerName>;
  tableG13: Set<BrokerName>;
  tableG18A: Set<BrokerName>;
  tableG1q7: Set<BrokerName>;
}

function emptyParsedData(): ParsedPdfData {
  return {
    rows8A: [],
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

function mergeParsedData(target: ParsedPdfData, incoming: ParsedPdfData, brokerName: BrokerName, sources: AggregatedSources): void {
  if (incoming.rows8A.length > 0) {
    target.rows8A.push(...incoming.rows8A.map(r => ({ ...r, _source: brokerName })));
    sources.table8A.add(brokerName);
  }

  if (incoming.rows92A.length > 0) {
    target.rows92A.push(...incoming.rows92A.map(r => ({ ...r, _source: brokerName })));
    sources.table92A.add(brokerName);
  }

  if (incoming.rows92B.length > 0) {
    target.rows92B.push(...incoming.rows92B.map(r => ({ ...r, _source: brokerName })));
    sources.table92B.add(brokerName);
  }

  if (incoming.rowsG9.length > 0) {
    target.rowsG9.push(...incoming.rowsG9.map(r => ({ ...r, _source: brokerName })));
    sources.tableG9.add(brokerName);
  }

  if (incoming.rowsG13.length > 0) {
    target.rowsG13.push(...incoming.rowsG13.map(r => ({ ...r, _source: brokerName })));
    sources.tableG13.add(brokerName);
  }

  if ((incoming.rowsG18A ?? []).length > 0) {
    target.rowsG18A.push(...(incoming.rowsG18A ?? []).map(r => ({ ...r, _source: brokerName })));
    sources.tableG18A.add(brokerName);
  }

  if ((incoming.rowsG1q7 ?? []).length > 0) {
    target.rowsG1q7.push(...(incoming.rowsG1q7 ?? []).map(r => ({ ...r, _source: brokerName })));
    sources.tableG1q7.add(brokerName);
  }

  if (incoming.warnings && incoming.warnings.length > 0) {
    if (!target.warnings) target.warnings = [];
    target.warnings.push(...incoming.warnings);
  }
}

function inferTargetRealizationYearFromXml(xmlText: string): string | undefined {
  const match = xmlText.match(/<Modelo3IRSv(\d{4})\b/);
  if (!match) {
    return undefined;
  }

  const filingCampaignYear = Number.parseInt(match[1], 10);
  if (!Number.isFinite(filingCampaignYear)) {
    return undefined;
  }

  return String(filingCampaignYear - 1);
}

/**
 * Parses all uploaded broker files and enriches the provided IRS XML.
 * Throws `NO_ROWS_FOUND_ERROR` when no supported rows are extracted.
 */
export async function processTaxFiles(input: ProcessTaxFilesInput): Promise<EnrichmentResult> {
  const originalXmlText = await input.xmlFile.text();
  const targetRealizationYear = inferTargetRealizationYearFromXml(originalXmlText);
  const parsedData = emptyParsedData();

  const sources: AggregatedSources = {
    table8A: new Set<BrokerName>(),
    table92A: new Set<BrokerName>(),
    table92B: new Set<BrokerName>(),
    tableG9: new Set<BrokerName>(),
    tableG13: new Set<BrokerName>(),
    tableG18A: new Set<BrokerName>(),
    tableG1q7: new Set<BrokerName>(),
  };

  const parseJobs: ParseJob[] = [
    {
      file: input.xtbCapitalGainsPdf,
      parser: parseXtbCapitalGainsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.xtbDividendsPdf,
      parser: parseXtbDividendsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.tradeRepublicPdf,
      parser: parseTradeRepublicPdf,
      brokerName: 'Trade Republic',
    },
    {
      file: input.trading212Pdf,
      parser: parseTrading212Pdf,
      brokerName: 'Trading 212',
    },
    {
      file: input.activoBankPdf,
      parser: parseActivoBankPdf,
      brokerName: 'ActivoBank',
    },
    {
      file: input.freedom24Pdf,
      parser: parseFreedom24Pdf,
      brokerName: 'Freedom24',
    },
    {
      file: input.ibkrPdf,
      parser: parseIbkrPdf,
      brokerName: 'IBKR',
    },
    {
      file: input.degiroTransactionsCsv,
      parser: file => parseDegiroTransactionsCsv(file, { targetRealizationYear }),
      brokerName: 'DEGIRO',
    },
    {
      file: input.binanceTransactionsXlsx,
      parser: parseBinanceTransactionsXlsx,
      brokerName: 'Binance',
    },
    {
      file: input.revolutConsolidatedPdf,
      parser: parseRevolutConsolidatedPdf,
      brokerName: 'Revolut',
    },
    {
      file: input.etradeGainLossXlsx,
      parser: file => parseEtradeGainLossWorkbook(file, { targetRealizationYear }),
      brokerName: 'E*TRADE',
    },
  ];

  for (const parseJob of parseJobs) {
    if (!parseJob.file) {
      continue;
    }

    const parsed = await parseJob.parser(parseJob.file);
    mergeParsedData(parsedData, parsed, parseJob.brokerName, sources);
  }

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG9.length + parsedData.rowsG13.length + parsedData.rowsG18A.length + parsedData.rowsG1q7.length;
  if (totalRows === 0 && !(parsedData.warnings && parsedData.warnings.length > 0)) {
    throw new Error(NO_ROWS_FOUND_ERROR);
  }

  return enrichXmlWithGains(originalXmlText, parsedData, {
    table8A: [...sources.table8A],
    table92A: [...sources.table92A],
    table92B: [...sources.table92B],
    tableG9: [...sources.tableG9],
    tableG13: [...sources.tableG13],
    tableG18A: [...sources.tableG18A],
    tableG1q7: [...sources.tableG1q7],
  });
}

/**
 * Parses all uploaded broker files and returns the raw parsed data without XML enrichment.
 * Throws `NO_ROWS_FOUND_ERROR` when no supported rows are extracted.
 */
export async function processBrokerFiles(input: ProcessBrokerFilesInput): Promise<BrokerFilesResult> {
  const parsedData = emptyParsedData();

  const sources: AggregatedSources = {
    table8A: new Set<BrokerName>(),
    table92A: new Set<BrokerName>(),
    table92B: new Set<BrokerName>(),
    tableG9: new Set<BrokerName>(),
    tableG13: new Set<BrokerName>(),
    tableG18A: new Set<BrokerName>(),
    tableG1q7: new Set<BrokerName>(),
  };

  const parseJobs: ParseJob[] = [
    {
      file: input.xtbCapitalGainsPdf,
      parser: parseXtbCapitalGainsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.xtbDividendsPdf,
      parser: parseXtbDividendsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.tradeRepublicPdf,
      parser: parseTradeRepublicPdf,
      brokerName: 'Trade Republic',
    },
    {
      file: input.trading212Pdf,
      parser: parseTrading212Pdf,
      brokerName: 'Trading 212',
    },
    {
      file: input.activoBankPdf,
      parser: parseActivoBankPdf,
      brokerName: 'ActivoBank',
    },
    {
      file: input.freedom24Pdf,
      parser: parseFreedom24Pdf,
      brokerName: 'Freedom24',
    },
    {
      file: input.ibkrPdf,
      parser: parseIbkrPdf,
      brokerName: 'IBKR',
    },
    {
      file: input.degiroTransactionsCsv,
      parser: parseDegiroTransactionsCsv,
      brokerName: 'DEGIRO',
    },
    {
      file: input.binanceTransactionsXlsx,
      parser: parseBinanceTransactionsXlsx,
      brokerName: 'Binance',
    },
    {
      file: input.revolutConsolidatedPdf,
      parser: parseRevolutConsolidatedPdf,
      brokerName: 'Revolut',
    },
    {
      file: input.etradeGainLossXlsx,
      parser: parseEtradeGainLossWorkbook,
      brokerName: 'E*TRADE',
    },
  ];

  for (const parseJob of parseJobs) {
    if (!parseJob.file) {
      continue;
    }

    const parsed = await parseJob.parser(parseJob.file);
    mergeParsedData(parsedData, parsed, parseJob.brokerName, sources);
  }

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG9.length + parsedData.rowsG13.length + parsedData.rowsG18A.length + parsedData.rowsG1q7.length;
  if (totalRows === 0 && !(parsedData.warnings && parsedData.warnings.length > 0)) {
    throw new Error(NO_ROWS_FOUND_ERROR);
  }

  return {
    parsedData,
    sources: {
      table8A: [...sources.table8A],
      table92A: [...sources.table92A],
      table92B: [...sources.table92B],
      tableG9: [...sources.tableG9],
      tableG13: [...sources.tableG13],
      tableG18A: [...sources.tableG18A],
      tableG1q7: [...sources.tableG1q7],
    },
    warnings: parsedData.warnings ?? [],
  };
}

/**
 * Triggers a browser download for an XML string and always revokes the object URL.
 */
export function downloadXmlFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
