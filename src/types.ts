/** Broker labels used in enrichment summaries. */
export type BrokerName = 'XTB' | 'Trade Republic' | 'Trading 212' | 'ActivoBank' | 'Freedom24' | 'IBKR' | 'DEGIRO' | 'Binance' | 'Revolut' | 'E*TRADE';

/** Common fields shared by IRS table rows that include country information. */
export interface BaseTaxRow {
  codPais: string;
  /** Broker that originated this row, stamped at merge time. */
  _source?: BrokerName;
}

/** Anexo J - Quadro 9.2 A row (capital gains sells/acquisitions). */
export interface TaxRow extends BaseTaxRow {
  codigo: string;
  anoRealizacao: string;
  mesRealizacao: string;
  diaRealizacao: string;
  valorRealizacao: string;
  anoAquisicao: string;
  mesAquisicao: string;
  diaAquisicao: string;
  valorAquisicao: string;
  despesasEncargos: string;
  impostoPagoNoEstrangeiro: string;
  codPaisContraparte: string;
}

/** Anexo J - Quadro 9.2 B row (other investment income). */
export interface TaxRow92B extends BaseTaxRow {
  codigo: string;
  rendimentoLiquido: string;
  impostoPagoNoEstrangeiro: string;
  codPaisContraparte: string;
}

/** Anexo J - Quadro 8 A row (dividends and interest). */
export interface TaxRow8A extends BaseTaxRow {
  codigo: string;
  rendimentoBruto: string;
  impostoPago: string;
}

/** Anexo G - Quadro 9 row (shares sold through a Portuguese entity). */
export interface TaxRowG9 {
  _source?: BrokerName;
  titular: string;
  nif: string;
  codEncargos: string;
  anoRealizacao: string;
  mesRealizacao: string;
  diaRealizacao: string;
  valorRealizacao: string;
  anoAquisicao: string;
  mesAquisicao: string;
  diaAquisicao: string;
  valorAquisicao: string;
  despesasEncargos: string;
  paisContraparte: string;
}

/** Anexo G - Quadro 13 row (CFDs/derivatives). */
export interface TaxRowG13 {
  _source?: BrokerName;
  codigoOperacao: string;
  titular: string;
  rendimentoLiquido: string;
  paisContraparte: string;
}

/** Anexo G - Quadro 18A row (crypto assets held < 365 days, taxable). */
export interface TaxRowG18A {
  _source?: BrokerName;
  titular: string;
  codPaisEntGestora: string;
  anoRealizacao: string;
  mesRealizacao: string;
  diaRealizacao: string;
  valorRealizacao: string;
  anoAquisicao: string;
  mesAquisicao: string;
  diaAquisicao: string;
  valorAquisicao: string;
  despesasEncargos: string;
  codPaisContraparte: string;
}

/** Anexo G1 - Quadro 7 row (crypto assets held >= 365 days, exempt). */
export interface TaxRowG1q7 {
  _source?: BrokerName;
  titular: string;
  codPaisEntGestora: string;
  anoRealizacao: string;
  mesRealizacao: string;
  diaRealizacao: string;
  valorRealizacao: string;
  anoAquisicao: string;
  mesAquisicao: string;
  diaAquisicao: string;
  valorAquisicao: string;
  despesasEncargos: string;
  codPaisContraparte: string;
}

/** Parsed broker data normalized to IRS table rows. */
export interface ParsedPdfData {
  rows8A: TaxRow8A[];
  rows92A: TaxRow[];
  rows92B: TaxRow92B[];
  rowsG9: TaxRowG9[];
  rowsG13: TaxRowG13[];
  rowsG18A: TaxRowG18A[];
  rowsG1q7: TaxRowG1q7[];
  /** Informational warnings from parsers (e.g. file accepted but no taxable events). */
  warnings: string[];
}

export interface TableSummary {
  /** Number of rows injected */
  rowsAdded: number;
  /** Map of label → formatted numeric total */
  totals: { label: string; value: string; currency?: boolean }[];
  /** Names of sources (brokers) that contributed rows */
  sources: string[];
}

export interface EnrichmentSummary {
  table8A: TableSummary;
  table92A: TableSummary;
  table92B: TableSummary;
  tableG9: TableSummary;
  tableG13: TableSummary;
  tableG18A: TableSummary;
  tableG1q7: TableSummary;
  /** Total rows across all tables */
  totalRowsAdded: number;
}

export interface EnrichmentResult {
  enrichedXml: string;
  originalXml: string;
  summary: EnrichmentSummary;
  warnings?: string[];
}
