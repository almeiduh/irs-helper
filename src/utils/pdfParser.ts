// Re-export all broker PDF parsers from their individual modules.
// This file acts as the public API surface — consumers import from here.
export { parseXtbCapitalGainsPdf, parseXtbDividendsPdf } from './pdfParsers/xtbParser';
export { parseTradeRepublicPdf } from './pdfParsers/tradeRepublicParser';
export { parseTrading212Pdf } from './pdfParsers/trading212Parser';
export { parseActivoBankPdf } from './pdfParsers/activoBankParser';
export { parseFreedom24Pdf } from './pdfParsers/freedom24Parser';
export { parseIbkrPdf } from './pdfParsers/ibkrParser';
export { parseRevolutConsolidatedPdf } from './pdfParsers/revolutParser';
export { parseDegiroPdf } from './pdfParsers/degiroParser';
export { parseOpenBankPdf } from './pdfParsers/openBankParser';
