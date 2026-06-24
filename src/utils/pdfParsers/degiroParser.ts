import type { TaxRow8A, ParsedPdfData } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { normalizeNumber, formatMoney, extractPdfText, matchesAnyMarker } from './common';
import { resolveCountryCodeFromIsin } from '../brokerCountries';

const DEGIRO_MARKERS = [
  /Visão geral da Carteira e dos Lucros\/Perdas/i,
  /Dividendos E Outras Remunerações/i,
  /flatexDEGIRO Bank/i,
  /DEGIRO/i,
];

// Matches a row like: "PT EDP SA 14 000,00 EUR 4 900,00 EUR 9 100,00 EUR"
// Group 1: Country Code
// Group 2: Product Name
// Group 3: Gross Value
// Group 4: Withholding Tax
// Group 5: Net Value
const REGEX_DIVIDENDS = /([A-Z]{2})\s+(.+?)\s+(\d[\d\s]*,\d{2})\s*EUR\s+(\d[\d\s]*,\d{2})\s*EUR\s+(\d[\d\s]*,\d{2})\s*EUR/g;

// Matches a row like: "DE 1 000,00 EUR 250,00 EUR 750,00 EUR"
// Group 1: Country Code
// Group 2: Gross Value
// Group 3: Withholding Tax
// Group 4: Net Value
const REGEX_COUPONS = /([A-Z]{2})\s+(\d[\d\s]*,\d{2})\s*EUR\s+(\d[\d\s]*,\d{2})\s*EUR\s+(\d[\d\s]*,\d{2})\s*EUR/g;

export async function parseDegiroPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  if (!matchesAnyMarker(fullText, DEGIRO_MARKERS)) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a DEGIRO Annual Report.`,
      'parser.error.degiro_pdf_wrong_file',
      { fileName: file.name }
    );
  }

  const rows8A: TaxRow8A[] = [];

  // Helper to extract rows within specific sections of the full text
  const extractFromSection = (
    text: string,
    startMarker: string,
    endMarkers: string[],
    regex: RegExp,
    type: 'E11' | 'E21'
  ) => {
    let searchIndex = 0;
    while (true) {
      const startIndex = text.toLowerCase().indexOf(startMarker.toLowerCase(), searchIndex);
      if (startIndex === -1) break;

      // Find the nearest end marker after this start marker
      let nearestEndIndex = text.length;
      for (const marker of endMarkers) {
        const idx = text.toLowerCase().indexOf(marker.toLowerCase(), startIndex + startMarker.length);
        if (idx !== -1 && idx < nearestEndIndex) {
          nearestEndIndex = idx;
        }
      }

      const sectionText = text.slice(startIndex, nearestEndIndex);
      
      let match;
      // Reset regex index for this slice
      regex.lastIndex = 0; 
      while ((match = regex.exec(sectionText)) !== null) {
        const countryCodeAlpha2 = match[1];
        // For E11, product name is group 2, gross is group 3. For E21, gross is group 2.
        const grossStr = type === 'E11' ? match[3] : match[2];
        const withholdingStr = type === 'E11' ? match[4] : match[3];
        
        const grossVal = normalizeNumber(grossStr);
        const withholdingVal = normalizeNumber(withholdingStr);

        if (parseFloat(grossVal) > 0) {
          const numericCountryCode = resolveCountryCodeFromIsin(countryCodeAlpha2) ?? countryCodeAlpha2;
          rows8A.push({
            codigo: type,
            codPais: numericCountryCode,
            rendimentoBruto: formatMoney(grossVal),
            impostoPago: formatMoney(withholdingVal),
          });
        }
      }
      
      searchIndex = nearestEndIndex;
      if (searchIndex >= text.length) break;
    }
  };

  // Extract Dividends (E11)
  extractFromSection(
    fullText,
    "Dividendos E Outras Remunerações Ao Acionista em EUR",
    [
      "Visão geral sobre os cupões",
      "Distribuições dos Fundos do Mercado Monetário",
      "Juros pagos e recebidos",
      "Transações"
    ],
    REGEX_DIVIDENDS,
    'E11'
  );

  // Extract Coupons (E21)
  extractFromSection(
    fullText,
    "Visão geral sobre os cupões em EUR",
    [
      "Distribuições dos Fundos do Mercado Monetário",
      "Juros pagos e recebidos",
      "Transações",
      "Compensação pelas retenções na fonte"
    ],
    REGEX_COUPONS,
    'E21'
  );

  if (rows8A.length === 0) {
    return {
      rows8A: [],
      rows92A: [],
      rows92B: [],
      rowsG9: [],
      rowsG13: [],
      rowsG18A: [],
      rowsG1q7: [],
      warnings: ['parser.warning.degiro_pdf_no_rows'],
    };
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}
