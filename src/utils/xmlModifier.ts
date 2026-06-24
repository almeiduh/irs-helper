import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG9, TaxRowG13, TaxRowG18A, TaxRowG1q7, ParsedPdfData, EnrichmentResult, EnrichmentSummary } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Parses the highest NLinha value in a target block to continue incremental numbering. */
function parseHighestNLinha(xml: string, blockName: string): number {
  let highest = 950;
  if (blockName === 'AnexoJq092BT01') highest = 990;
  if (blockName === 'AnexoJq08AT01') highest = 800; // 8.A starts at 801
  if (blockName === 'AnexoGq09T01') highest = 9000; // G09 starts at 9001
  if (blockName === 'AnexoGq18AT01') highest = 18000;
  if (blockName === 'AnexoG1q07T01') highest = 700;
  const re = /<NLinha>(\d+)<\/NLinha>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = parseInt(m[1], 10);
    if (v > highest) highest = v;
  }
  return highest;
}

/** Parses the highest Linha@numero already present in a target block. */
function parseHighestNumero(xml: string, blockName: string): number {
  let highest = 0;
  const re = new RegExp(`<${blockName}-Linha\\s[^>]*numero="(\\d+)"`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = parseInt(m[1], 10);
    if (v > highest) highest = v;
  }
  return highest;
}

/** Aggregates numeric XML tag values for pre-existing rows in a block. */
function sumField(tag: string, text: string): number {
  let total = 0;
  const re = new RegExp(`<${tag}>(-?[\\d.]+)<\\/${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) total += parseFloat(m[1]);
  return total;
}

/** Updates or inserts a Soma node while preserving indentation from surrounding XML. */
function upsertSomaNode(xml: string, tag: string, value: number, searchStartIdx: number, quadroName: string): string {
  const formatted = value.toFixed(2);
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const idx = xml.indexOf(openTag, searchStartIdx);
  if (idx !== -1) {
    const closeIdx = xml.indexOf(closeTag, idx);
    return xml.slice(0, idx + openTag.length) + formatted + xml.slice(closeIdx);
  }
  const quadroClose = `</${quadroName}>`;
  const qIdx = xml.indexOf(quadroClose, searchStartIdx);
  if (qIdx === -1) return xml;
  const lineStart = xml.lastIndexOf('\n', qIdx);
  const lineIndent = lineStart !== -1 ? xml.slice(lineStart + 1, qIdx).match(/^(\s*)/)?.[1] ?? '      ' : '      ';
  const newNode = `\n${lineIndent}${openTag}${formatted}${closeTag}`;
  return xml.slice(0, qIdx) + newNode + '\n' + xml.slice(qIdx);
}

function parseMoney(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumBy<T>(rows: T[], getter: (row: T) => string): number {
  return rows.reduce((total, row) => total + parseMoney(getter(row)), 0);
}

function validateXmlShape(xml: string, data: ParsedPdfData): void {
  if (!xml.includes('<Modelo3')) {
    throw new Error('Invalid XML: expected a Modelo3 root node.');
  }

  const needsAnexoJ = data.rows8A.length > 0 || data.rows92A.length > 0 || data.rows92B.length > 0;
  if (needsAnexoJ && !xml.includes('<AnexoJ')) {
    throw new Error('Invalid XML: Anexo J is required for the selected broker reports.');
  }

  const needsAnexoG = data.rowsG9.length > 0 || data.rowsG13.length > 0;
  if (needsAnexoG && !/<AnexoG[\s>]/.test(xml)) {
    throw new Error('Invalid XML: Anexo G is required for the selected broker reports.');
  }

  const needsAnexoGForCrypto = (data.rowsG18A ?? []).length > 0;
  if (needsAnexoGForCrypto && !/<AnexoG[\s>]/.test(xml)) {
    throw new Error('Invalid XML: Anexo G is required for crypto capital gains.');
  }

  const needsAnexoG1 = (data.rowsG1q7 ?? []).length > 0;
  if (needsAnexoG1 && !xml.includes('<AnexoG1')) {
    throw new Error('Invalid XML: Anexo G1 is required for crypto capital gains held >= 365 days.');
  }
}

// ---------------------------------------------------------------------------
// Block Injector Generic Function
// ---------------------------------------------------------------------------

interface InjectConfig<T> {
  containerName: string;
  quadroName: string;
  rows: T[];
  buildFields: (row: T, nLinha: number) => [string, string][];
  somaNodes: { tag: string; fieldToSum: string; computeNewSoma: (rows: T[]) => number }[];
}

function processBlock<T>(originalXml: string, config: InjectConfig<T>, searchStartIdx: number): string {
  if (config.rows.length === 0) return originalXml;

  let xml = originalXml;
  const containerOpen = `<${config.containerName}>`;
  const containerClose = `</${config.containerName}>`;
  const containerEmpty = `<${config.containerName}/>`;

  if (xml.indexOf(containerEmpty, searchStartIdx) !== -1) {
    xml = xml.replace(containerEmpty, `${containerOpen}${containerClose}`);
  }

  if (xml.indexOf(containerOpen, searchStartIdx) === -1) {
    const quadroClose = `</${config.quadroName}>`;
    const qIdx = xml.indexOf(quadroClose, searchStartIdx);
    if (qIdx === -1) throw new Error(`${config.quadroName} not found in the XML.`);
    const lineStart = xml.lastIndexOf('\n', qIdx);
    const lineIndent = lineStart !== -1 ? (xml.slice(lineStart + 1, qIdx).match(/^(\s*)/)?.[1] ?? '      ') : '      ';
    const injection = `\n${lineIndent}${containerOpen}${containerClose}\n`;
    xml = xml.slice(0, qIdx) + injection + xml.slice(qIdx);
  }

  const containerOpenIdx = xml.indexOf(containerOpen, searchStartIdx);
  const containerCloseIdx = xml.indexOf(containerClose, containerOpenIdx);
  const existingBlock = xml.slice(containerOpenIdx + containerOpen.length, containerCloseIdx);

  let linhaIndent = '          ';
  let fieldIndent = '            ';
  const firstChildMatch = existingBlock.match(/\n(\s+)</);
  if (firstChildMatch) {
    linhaIndent = firstChildMatch[1];
    fieldIndent = linhaIndent + '  ';
  } else {
    const containerLine = xml.lastIndexOf('\n', containerOpenIdx);
    if (containerLine !== -1) {
      const containerIndentMatch = xml.slice(containerLine + 1, containerOpenIdx).match(/^(\s*)/);
      if (containerIndentMatch) {
        linhaIndent = containerIndentMatch[1] + '  ';
        fieldIndent = linhaIndent + '  ';
      }
    }
  }

  let nextNLinha = parseHighestNLinha(existingBlock, config.containerName) + 1;
  let nextNumero = parseHighestNumero(existingBlock, config.containerName) + 1;

  const newLinhasXml = config.rows.map(row => {
    const fields = config.buildFields(row, nextNLinha);
    nextNLinha++;
    const inner = fields.map(([name, value]) => `${fieldIndent}<${name}>${value}</${name}>`).join('\n');
    const linha = `${linhaIndent}<${config.containerName}-Linha numero="${nextNumero}">\n` + inner + '\n' + `${linhaIndent}</${config.containerName}-Linha>`;
    nextNumero++;
    return linha;
  }).join('\n');

  const containerIndentLine = xml.lastIndexOf('\n', containerCloseIdx);
  const containerIndent = containerIndentLine !== -1 ? (xml.slice(containerIndentLine + 1, containerCloseIdx).match(/^(\s*)/)?.[1] ?? '') : '';
  const insertion = '\n' + newLinhasXml + '\n' + containerIndent;

  const closeTagPos = xml.indexOf(containerClose, containerOpenIdx);
  xml = xml.slice(0, closeTagPos) + insertion + xml.slice(closeTagPos);

  for (const somaConfig of config.somaNodes) {
    const existingVal = sumField(somaConfig.fieldToSum, existingBlock);
    const newVal = somaConfig.computeNewSoma(config.rows);
    xml = upsertSomaNode(xml, somaConfig.tag, existingVal + newVal, searchStartIdx, config.quadroName);
  }

  return xml;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function enrichXmlWithGains(
  originalXml: string, 
  data: ParsedPdfData, 
  sources: { table8A: string[], table92A: string[], table92B: string[], tableG9: string[], tableG13: string[], tableG18A: string[], tableG1q7: string[] } = { table8A: [], table92A: [], table92B: [], tableG9: [], tableG13: [], tableG18A: [], tableG1q7: [] }
): EnrichmentResult {
  const { rows8A, rows92A, rows92B, rowsG9, rowsG13 } = data;
  const rowsG18A = data.rowsG18A ?? [];
  const rowsG1q7 = data.rowsG1q7 ?? [];
  validateXmlShape(originalXml, data);
  
  const emptySummary: EnrichmentSummary = {
    table8A: { rowsAdded: 0, totals: [], sources: [] },
    table92A: { rowsAdded: 0, totals: [], sources: [] },
    table92B: { rowsAdded: 0, totals: [], sources: [] },
    tableG9: { rowsAdded: 0, totals: [], sources: [] },
    tableG13: { rowsAdded: 0, totals: [], sources: [] },
    tableG18A: { rowsAdded: 0, totals: [], sources: [] },
    tableG1q7: { rowsAdded: 0, totals: [], sources: [] },
    totalRowsAdded: 0,
  };

  if (rows8A.length === 0 && rows92A.length === 0 && rows92B.length === 0 && rowsG9.length === 0 && rowsG13.length === 0 && rowsG18A.length === 0 && rowsG1q7.length === 0) {
    return {
      originalXml,
      enrichedXml: originalXml,
      summary: emptySummary,
    };
  }

  let xml = originalXml;

  // Helper to expand self-closing quadro tags within a bounded annex region
  const expandSelfClosing = (tagName: string, startIdx: number, endIdx: number) => {
    const qEmptyIdx = xml.indexOf(`<${tagName}/>`, startIdx);
    if (qEmptyIdx !== -1 && (endIdx === -1 || qEmptyIdx < endIdx)) {
      const lineStart = xml.lastIndexOf('\n', qEmptyIdx);
      const lineIndent = lineStart !== -1 ? (xml.slice(lineStart + 1, qEmptyIdx).match(/^(\s*)/)?.[1] ?? '    ') : '    ';
      xml = xml.slice(0, qEmptyIdx) + `<${tagName}>\n${lineIndent}</${tagName}>` + xml.slice(qEmptyIdx + `<${tagName}/>`.length);
    }
  };

  // ---------------------------------------------------------------------------
  // Anexo J enrichment
  // ---------------------------------------------------------------------------
  const anexoJOpenIdx = xml.indexOf('<AnexoJ');
  if (anexoJOpenIdx !== -1 && (rows8A.length > 0 || rows92A.length > 0 || rows92B.length > 0)) {
    const anexoJCloseIdx = xml.indexOf('</AnexoJ>', anexoJOpenIdx);

    expandSelfClosing('Quadro08', anexoJOpenIdx, anexoJCloseIdx);
    expandSelfClosing('Quadro09', anexoJOpenIdx, anexoJCloseIdx);

    const anexoJBlocks: InjectConfig<TaxRow8A | TaxRow | TaxRow92B>[] = [
      {
        containerName: 'AnexoJq08AT01',
        quadroName: 'Quadro08',
        rows: rows8A,
        buildFields: (row, nLinha) => {
          const typedRow = row as TaxRow8A;
          return [
            ['NLinha', String(nLinha)],
            ['CodRendimento', typedRow.codigo],
            ['CodPais', typedRow.codPais],
            ['RendimentoBruto', typedRow.rendimentoBruto],
            ['ImpostoPagoEstrangeiroPaisFonte', typedRow.impostoPago],
          ];
        },
        somaNodes: [
          { tag: 'AnexoJq08AT01SomaC01', fieldToSum: 'RendimentoBruto', computeNewSoma: rows => sumBy(rows as TaxRow8A[], r => r.rendimentoBruto) },
          { tag: 'AnexoJq08AT01SomaC02', fieldToSum: 'ImpostoPagoEstrangeiroPaisFonte', computeNewSoma: rows => sumBy(rows as TaxRow8A[], r => r.impostoPago) },
        ],
      },
      {
        containerName: 'AnexoJq092AT01',
        quadroName: 'Quadro09',
        rows: rows92A,
        buildFields: (row, nLinha) => {
          const typedRow = row as TaxRow;
          const fields: [string, string][] = [
            ['NLinha', String(nLinha)],
            ['CodPais', typedRow.codPais],
            ['Codigo', typedRow.codigo],
            ['AnoRealizacao', typedRow.anoRealizacao],
            ['MesRealizacao', typedRow.mesRealizacao],
            ['DiaRealizacao', typedRow.diaRealizacao],
            ['ValorRealizacao', typedRow.valorRealizacao],
            ['AnoAquisicao', typedRow.anoAquisicao],
            ['MesAquisicao', typedRow.mesAquisicao],
            ['DiaAquisicao', typedRow.diaAquisicao],
            ['ValorAquisicao', typedRow.valorAquisicao],
            ['DespesasEncargos', typedRow.despesasEncargos],
            ['ImpostoPagoNoEstrangeiro', typedRow.impostoPagoNoEstrangeiro],
            ['CodPaisContraparte', typedRow.codPaisContraparte],
          ];
          if (typedRow.valMobAdmNeg) {
            fields.push(['ValMobAdmNeg', typedRow.valMobAdmNeg]);
          }
          return fields;
        },
        somaNodes: [
          { tag: 'AnexoJq092AT01SomaC01', fieldToSum: 'ValorRealizacao', computeNewSoma: rows => sumBy(rows as TaxRow[], r => r.valorRealizacao) },
          { tag: 'AnexoJq092AT01SomaC02', fieldToSum: 'ValorAquisicao', computeNewSoma: rows => sumBy(rows as TaxRow[], r => r.valorAquisicao) },
          { tag: 'AnexoJq092AT01SomaC03', fieldToSum: 'DespesasEncargos', computeNewSoma: rows => sumBy(rows as TaxRow[], r => r.despesasEncargos) },
          { tag: 'AnexoJq092AT01SomaC04', fieldToSum: 'ImpostoPagoNoEstrangeiro', computeNewSoma: rows => sumBy(rows as TaxRow[], r => r.impostoPagoNoEstrangeiro) },
        ],
      },
      {
        containerName: 'AnexoJq092BT01',
        quadroName: 'Quadro09',
        rows: rows92B,
        buildFields: (row, nLinha) => {
          const typedRow = row as TaxRow92B;
          return [
            ['NLinha', String(nLinha)],
            ['CodRendimento', typedRow.codigo],
            ['CodPais', typedRow.codPais],
            ['RendimentoLiquido', typedRow.rendimentoLiquido],
            ['ImpostoPagoEstrangeiro', typedRow.impostoPagoNoEstrangeiro],
          ];
        },
        somaNodes: [
          { tag: 'AnexoJq092BT01SomaC01', fieldToSum: 'RendimentoLiquido', computeNewSoma: rows => sumBy(rows as TaxRow92B[], r => r.rendimentoLiquido) },
          { tag: 'AnexoJq092BT01SomaC02', fieldToSum: 'ImpostoPagoEstrangeiro', computeNewSoma: rows => sumBy(rows as TaxRow92B[], r => r.impostoPagoNoEstrangeiro) },
        ],
      },
    ];

    for (const config of anexoJBlocks) {
      xml = processBlock(xml, config, anexoJOpenIdx);
    }
  }

  // ---------------------------------------------------------------------------
  // Anexo G enrichment (Quadro 09 – Shares sold through PT entities)
  // ---------------------------------------------------------------------------
  const anexoGMatch = /<AnexoG[\s>]/.exec(xml);
  const anexoGOpenIdx = anexoGMatch ? anexoGMatch.index : -1;
  if (anexoGOpenIdx !== -1 && (rowsG9.length > 0 || rowsG13.length > 0 || rowsG18A.length > 0)) {
    const anexoGCloseIdx = xml.indexOf('</AnexoG>', anexoGOpenIdx);
    expandSelfClosing('Quadro09', anexoGOpenIdx, anexoGCloseIdx);
    expandSelfClosing('Quadro13', anexoGOpenIdx, anexoGCloseIdx);

    if (rowsG9.length > 0) {
      xml = processBlock<TaxRowG9>(xml, {
        containerName: 'AnexoGq09T01',
        quadroName: 'Quadro09',
        rows: rowsG9,
        buildFields: (row, nLinha) => [
          ['NLinha', String(nLinha)],
          ['Titular', row.titular],
          ['NIF', row.nif],
          ['CodEncargos', row.codEncargos],
          ['AnoRealizacao', row.anoRealizacao],
          ['MesRealizacao', row.mesRealizacao],
          ['DiaRealizacao', row.diaRealizacao],
          ['ValorRealizacao', row.valorRealizacao],
          ['AnoAquisicao', row.anoAquisicao],
          ['MesAquisicao', row.mesAquisicao],
          ['DiaAquisicao', row.diaAquisicao],
          ['ValorAquisicao', row.valorAquisicao],
          ['DespesasEncargos', row.despesasEncargos],
          ['PaisContraparte', row.paisContraparte],
        ],
        somaNodes: [
          { tag: 'AnexoGq09T01SomaC01', fieldToSum: 'ValorRealizacao', computeNewSoma: rows => sumBy(rows, r => r.valorRealizacao) },
          { tag: 'AnexoGq09T01SomaC02', fieldToSum: 'ValorAquisicao', computeNewSoma: rows => sumBy(rows, r => r.valorAquisicao) },
          { tag: 'AnexoGq09T01SomaC03', fieldToSum: 'DespesasEncargos', computeNewSoma: rows => sumBy(rows, r => r.despesasEncargos) },
        ],
      }, anexoGOpenIdx);
    }

    if (rowsG13.length > 0) {
      xml = processBlock<TaxRowG13>(xml, {
      containerName: 'AnexoGq13T01',
      quadroName: 'Quadro13',
      rows: rowsG13,
      buildFields: (row, nLinha) => {
        void nLinha;
        return [
        ['CodigoOperacao', row.codigoOperacao],
        ['Titular', row.titular],
        ['RendimentoLiquido', row.rendimentoLiquido],
        ['PaisContraparte', row.paisContraparte],
        ];
      },
      somaNodes: [
        { tag: 'AnexoGq13T01SomaC01', fieldToSum: 'RendimentoLiquido', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.rendimentoLiquido), 0) },
      ]
    }, anexoGOpenIdx);
    }

    if (rowsG18A.length > 0) {
      expandSelfClosing('Quadro18', anexoGOpenIdx, anexoGCloseIdx);
      xml = processBlock<TaxRowG18A>(xml, {
        containerName: 'AnexoGq18AT01',
        quadroName: 'Quadro18',
        rows: rowsG18A,
        buildFields: (row, nLinha) => [
          ['NLinha', String(nLinha)],
          ['Titular', row.titular],
          ['CodPaisEntGestora', row.codPaisEntGestora],
          ['AnoRealizacao', row.anoRealizacao],
          ['MesRealizacao', row.mesRealizacao],
          ['DiaRealizacao', row.diaRealizacao],
          ['ValorRealizacao', row.valorRealizacao],
          ['AnoAquisicao', row.anoAquisicao],
          ['MesAquisicao', row.mesAquisicao],
          ['DiaAquisicao', row.diaAquisicao],
          ['ValorAquisicao', row.valorAquisicao],
          ['DespesasEncargos', row.despesasEncargos],
          ['CodPaisContraparte', row.codPaisContraparte],
        ],
        somaNodes: [
          { tag: 'AnexoGq18AT01SomaC01', fieldToSum: 'ValorRealizacao', computeNewSoma: rows => sumBy(rows, r => r.valorRealizacao) },
          { tag: 'AnexoGq18AT01SomaC02', fieldToSum: 'ValorAquisicao', computeNewSoma: rows => sumBy(rows, r => r.valorAquisicao) },
          { tag: 'AnexoGq18AT01SomaC03', fieldToSum: 'DespesasEncargos', computeNewSoma: rows => sumBy(rows, r => r.despesasEncargos) },
        ],
      }, anexoGOpenIdx);
    }
  }

  // ---------------------------------------------------------------------------
  // Anexo G1 enrichment (Quadro 07 – crypto assets held >= 365 days, exempt)
  // ---------------------------------------------------------------------------
  const anexoG1Match = /<AnexoG1[\s>]/.exec(xml);
  const anexoG1OpenIdx = anexoG1Match ? anexoG1Match.index : -1;
  if (anexoG1OpenIdx !== -1 && rowsG1q7.length > 0) {
    const anexoG1CloseIdx = xml.indexOf('</AnexoG1>', anexoG1OpenIdx);
    expandSelfClosing('Quadro07', anexoG1OpenIdx, anexoG1CloseIdx);
    xml = processBlock<TaxRowG1q7>(xml, {
      containerName: 'AnexoG1q07T01',
      quadroName: 'Quadro07',
      rows: rowsG1q7,
      buildFields: (row, nLinha) => [
        ['NLinha', String(nLinha)],
        ['Titular', row.titular],
        ['CodPaisEntGestora', row.codPaisEntGestora],
        ['AnoRealizacao', row.anoRealizacao],
        ['MesRealizacao', row.mesRealizacao],
        ['DiaRealizacao', row.diaRealizacao],
        ['ValorRealizacao', row.valorRealizacao],
        ['AnoAquisicao', row.anoAquisicao],
        ['MesAquisicao', row.mesAquisicao],
        ['DiaAquisicao', row.diaAquisicao],
        ['ValorAquisicao', row.valorAquisicao],
        ['DespesasEncargos', row.despesasEncargos],
        ['CodPaisContraparte', row.codPaisContraparte],
      ],
      somaNodes: [
        { tag: 'AnexoG1q07T01SomaC01', fieldToSum: 'ValorRealizacao', computeNewSoma: rows => sumBy(rows, r => r.valorRealizacao) },
        { tag: 'AnexoG1q07T01SomaC02', fieldToSum: 'ValorAquisicao', computeNewSoma: rows => sumBy(rows, r => r.valorAquisicao) },
        { tag: 'AnexoG1q07T01SomaC03', fieldToSum: 'DespesasEncargos', computeNewSoma: rows => sumBy(rows, r => r.despesasEncargos) },
      ],
    }, anexoG1OpenIdx);
  }

  // Build summary
  const fmt = (n: number) => n.toFixed(2);

  const summary: EnrichmentSummary = {
    table8A: {
      rowsAdded: rows8A.length,
      sources: sources.table8A,
      totals: rows8A.length === 0 ? [] : [
        { label: 'report.totals.gross_income', value: fmt(sumBy(rows8A, r => r.rendimentoBruto)), currency: true },
        { label: 'report.totals.tax_paid_abroad', value: fmt(sumBy(rows8A, r => r.impostoPago)), currency: true },
      ],
    },
    table92A: {
      rowsAdded: rows92A.length,
      sources: sources.table92A,
      totals: rows92A.length === 0 ? [] : [
        { label: 'report.totals.realisation_value', value: fmt(sumBy(rows92A, r => r.valorRealizacao)), currency: true },
        { label: 'report.totals.acquisition_value', value: fmt(sumBy(rows92A, r => r.valorAquisicao)), currency: true },
        { label: 'report.totals.expenses_charges', value: fmt(sumBy(rows92A, r => r.despesasEncargos)), currency: true },
        { label: 'report.totals.tax_paid_abroad', value: fmt(sumBy(rows92A, r => r.impostoPagoNoEstrangeiro)), currency: true },
      ],
    },
    table92B: {
      rowsAdded: rows92B.length,
      sources: sources.table92B,
      totals: rows92B.length === 0 ? [] : [
        { label: 'report.totals.net_income', value: fmt(sumBy(rows92B, r => r.rendimentoLiquido)), currency: true },
        { label: 'report.totals.tax_paid_abroad', value: fmt(sumBy(rows92B, r => r.impostoPagoNoEstrangeiro)), currency: true },
      ],
    },
    tableG9: {
      rowsAdded: rowsG9.length,
      sources: sources.tableG9,
      totals: rowsG9.length === 0 ? [] : [
        { label: 'report.totals.realisation_value', value: fmt(sumBy(rowsG9, r => r.valorRealizacao)), currency: true },
        { label: 'report.totals.acquisition_value', value: fmt(sumBy(rowsG9, r => r.valorAquisicao)), currency: true },
        { label: 'report.totals.expenses_charges', value: fmt(sumBy(rowsG9, r => r.despesasEncargos)), currency: true },
      ],
    },
    tableG13: {
      rowsAdded: rowsG13.length,
      sources: sources.tableG13,
      totals: rowsG13.length === 0 ? [] : [
        { label: 'report.totals.net_income', value: fmt(sumBy(rowsG13, r => r.rendimentoLiquido)), currency: true },
      ],
    },
    tableG18A: {
      rowsAdded: rowsG18A.length,
      sources: sources.tableG18A,
      totals: rowsG18A.length === 0 ? [] : [
        { label: 'report.totals.realisation_value', value: fmt(sumBy(rowsG18A, r => r.valorRealizacao)), currency: true },
        { label: 'report.totals.acquisition_value', value: fmt(sumBy(rowsG18A, r => r.valorAquisicao)), currency: true },
        { label: 'report.totals.expenses_charges', value: fmt(sumBy(rowsG18A, r => r.despesasEncargos)), currency: true },
      ],
    },
    tableG1q7: {
      rowsAdded: rowsG1q7.length,
      sources: sources.tableG1q7,
      totals: rowsG1q7.length === 0 ? [] : [
        { label: 'report.totals.realisation_value', value: fmt(sumBy(rowsG1q7, r => r.valorRealizacao)), currency: true },
        { label: 'report.totals.acquisition_value', value: fmt(sumBy(rowsG1q7, r => r.valorAquisicao)), currency: true },
        { label: 'report.totals.expenses_charges', value: fmt(sumBy(rowsG1q7, r => r.despesasEncargos)), currency: true },
      ],
    },
    totalRowsAdded: rows8A.length + rows92A.length + rows92B.length + rowsG9.length + rowsG13.length + rowsG18A.length + rowsG1q7.length,
  };

  return { originalXml, enrichedXml: xml, summary, warnings: data.warnings };
}
