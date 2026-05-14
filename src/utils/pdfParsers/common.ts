import * as pdfjsLib from 'pdfjs-dist';

import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { BrokerParsingError } from '../parserErrors';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 200;

export function normalizeNumber(value: string): string {
  return value.replace(/\s/g, '').replace(/,/g, '.');
}

export function formatMoney(value: number | string): string {
  if (typeof value === 'string') {
    return parseFloat(value).toFixed(2);
  }
  return value.toFixed(2);
}

function validatePdfSize(file: File): void {
  if (file.size > MAX_PDF_BYTES) {
    throw new BrokerParsingError(
      `"${file.name}" exceeds the maximum supported file size.`,
      'parser.error.file_too_large',
      { fileName: file.name }
    );
  }
}

function itemToString(item: unknown): string {
  if (typeof item === 'object' && item !== null && 'str' in item) {
    const str = (item as { str?: unknown }).str;
    return typeof str === 'string' ? str : '';
  }
  return '';
}

export async function extractPdfText(file: File): Promise<string[]> {
  validatePdfSize(file);

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new BrokerParsingError(
      `"${file.name}" contains too many pages to be processed safely.`,
      'parser.error.too_many_pages',
      { fileName: file.name }
    );
  }

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map(itemToString).join(' '));
  }

  return pageTexts;
}

export function extractRows<T>(
  pageTexts: string[],
  sourceRegex: RegExp,
  buildRow: (match: RegExpExecArray) => T,
): T[] {
  const rows: T[] = [];

  for (const text of pageTexts) {
    const regex = new RegExp(sourceRegex.source, sourceRegex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      rows.push(buildRow(match));
    }
  }

  return rows;
}

export function matchesAnyMarker(fullText: string, markers: RegExp[]): boolean {
  return markers.some(marker => marker.test(fullText));
}
