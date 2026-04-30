import { useState } from 'react';
import { TrendingUp, Receipt, Landmark, CheckCircle2, Activity, Coins, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnrichmentSummary, ParsedPdfData, TaxRow, TaxRow8A, TaxRow92B, TaxRowG1q7, TaxRowG9, TaxRowG13, TaxRowG18A } from '../types';
import { getBrokerBadgeMeta } from '../utils/brokerBadgeMeta';

interface EnrichmentReportProps {
  summary: EnrichmentSummary;
  parsedData: ParsedPdfData;
}

interface CreatedRowField {
  label: string;
  value: string;
  currency?: boolean;
}

interface CreatedRowPreview {
  id: string;
  line: string;
  source?: string;
  asset?: string;
  fields: CreatedRowField[];
}

interface TableCardProps {
  id: string;
  title: string;
  subtitle: string;
  rowsAdded: number;
  totals: { label: string; value: string; currency?: boolean }[];
  sources: string[];
  icon: React.ReactNode;
  colorClass: string;
  createdRows: CreatedRowPreview[];
}

function formatCurrencyValue(value: string): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;

  return `€ ${numericValue.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateParts(year: string, month: string, day: string): string {
  return [day, month, year].filter(Boolean).join('/');
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`broker-badge ${getBrokerBadgeMeta(source)?.badgeClass ?? ''}`}>
      {getBrokerBadgeMeta(source)?.shortLabel ?? source}
    </span>
  );
}

function TableCard({ id, title, subtitle, rowsAdded, totals, sources, icon, colorClass, createdRows }: TableCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  if (rowsAdded === 0) return null; // Don't show inactive tables at all

  const previewId = `created-rows-${id}`;
  const hasCreatedRows = createdRows.length > 0;

  const getSourceTagClass = (source: string) => {
    return getBrokerBadgeMeta(source)?.sourceTagClass ?? '';
  };

  return (
    <div className={`enrichment-card ${colorClass}`}>
      <div className="enrichment-card__header">
        <span className="enrichment-card__icon">{icon}</span>
        <div>
          <h3 className="enrichment-card__title">{title}</h3>
          <p className="enrichment-card__subtitle">{subtitle}</p>
        </div>
        <div className="enrichment-card__actions">
          <span className="enrichment-card__badge">+{rowsAdded} {rowsAdded !== 1 ? t('report.rows_plural') : t('report.rows')}</span>
          {hasCreatedRows && (
            <button
              type="button"
              className="enrichment-card__expand-button"
              onClick={() => setIsExpanded(current => !current)}
              aria-expanded={isExpanded}
              aria-controls={previewId}
              aria-label={isExpanded ? t('report.hide_created_rows') : t('report.show_created_rows')}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="enrichment-card__sources">
        {sources.map(s => (
          <span key={s} className={`enrichment-card__source-tag ${getSourceTagClass(s)}`}>
            {getBrokerBadgeMeta(s)?.shortLabel ?? s}
          </span>
        ))}
      </div>

      {totals.length > 0 && (
        <dl className="enrichment-card__totals">
          {totals.map(({ label, value, currency }) => (
            <div key={label} className="enrichment-card__total-row">
              <dt className="enrichment-card__total-label">{t(label)}</dt>
              <dd className="enrichment-card__total-value">
                {currency ? `€ ${Number(value).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {hasCreatedRows && isExpanded && (
        <div className="enrichment-card__created-rows" id={previewId}>
          <p className="enrichment-card__created-rows-title">{t('report.created_rows_title')}</p>
          <div className="created-rows-list">
            {createdRows.map(row => (
              <article key={row.id} className="created-row-card">
                <div className="created-row-card__meta">
                  <span className="created-row-card__line">{row.line}</span>
                  {row.source && <SourceBadge source={row.source} />}
                  {row.asset && <span className="created-row-card__asset" title={row.asset}>{row.asset}</span>}
                </div>
                <dl className="created-row-card__fields">
                  {row.fields.map(field => (
                    <div key={field.label} className="created-row-card__field">
                      <dt>{field.label}</dt>
                      <dd>{field.currency ? formatCurrencyValue(field.value) : field.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EnrichmentReport({ summary, parsedData }: EnrichmentReportProps) {
  const { t } = useTranslation();
  const activeTablesCount = [summary.table8A, summary.table92A, summary.table92B, summary.tableG9, summary.tableG13, summary.tableG18A, summary.tableG1q7].filter(t => t.rowsAdded > 0).length;

  const row8APreviews: CreatedRowPreview[] = parsedData.rows8A.map((row: TaxRow8A, index) => ({
    id: `8a-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Código Rendimento', value: row.codigo },
      { label: 'País da Fonte', value: row.codPais },
      { label: t('report.totals.gross_income'), value: row.rendimentoBruto, currency: true },
      { label: t('report.totals.tax_paid_abroad'), value: row.impostoPago, currency: true },
    ],
  }));

  const row92APreviews: CreatedRowPreview[] = parsedData.rows92A.map((row: TaxRow, index) => ({
    id: `92a-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'País da Fonte', value: row.codPais },
      { label: 'Código', value: row.codigo },
      { label: 'Data de Realização', value: formatDateParts(row.anoRealizacao, row.mesRealizacao, row.diaRealizacao) },
      { label: t('report.totals.realisation_value'), value: row.valorRealizacao, currency: true },
      { label: 'Data de Aquisição', value: formatDateParts(row.anoAquisicao, row.mesAquisicao, row.diaAquisicao) },
      { label: t('report.totals.acquisition_value'), value: row.valorAquisicao, currency: true },
      { label: t('report.totals.expenses_charges'), value: row.despesasEncargos, currency: true },
      { label: t('report.totals.tax_paid_abroad'), value: row.impostoPagoNoEstrangeiro, currency: true },
      { label: 'País da Contraparte', value: row.codPaisContraparte },
    ],
  }));

  const row92BPreviews: CreatedRowPreview[] = parsedData.rows92B.map((row: TaxRow92B, index) => ({
    id: `92b-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Código Rendimento', value: row.codigo },
      { label: 'País da Fonte', value: row.codPais },
      { label: t('report.totals.net_income'), value: row.rendimentoLiquido, currency: true },
      { label: t('report.totals.tax_paid_abroad'), value: row.impostoPagoNoEstrangeiro, currency: true },
      { label: 'País da Contraparte', value: row.codPaisContraparte },
    ],
  }));

  const rowG9Previews: CreatedRowPreview[] = parsedData.rowsG9.map((row: TaxRowG9, index) => ({
    id: `g9-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Titular', value: row.titular },
      { label: 'NIF', value: row.nif },
      { label: 'Cód. Encargos', value: row.codEncargos },
      { label: 'Data de Realização', value: formatDateParts(row.anoRealizacao, row.mesRealizacao, row.diaRealizacao) },
      { label: t('report.totals.realisation_value'), value: row.valorRealizacao, currency: true },
      { label: 'Data de Aquisição', value: formatDateParts(row.anoAquisicao, row.mesAquisicao, row.diaAquisicao) },
      { label: t('report.totals.acquisition_value'), value: row.valorAquisicao, currency: true },
      { label: t('report.totals.expenses_charges'), value: row.despesasEncargos, currency: true },
      { label: 'País da Contraparte', value: row.paisContraparte },
    ],
  }));

  const rowG13Previews: CreatedRowPreview[] = parsedData.rowsG13.map((row: TaxRowG13, index) => ({
    id: `g13-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Código da Operação', value: row.codigoOperacao },
      { label: 'Titular', value: row.titular },
      { label: t('report.totals.net_income'), value: row.rendimentoLiquido, currency: true },
      { label: 'País da Contraparte', value: row.paisContraparte },
    ],
  }));

  const rowG18APreviews: CreatedRowPreview[] = parsedData.rowsG18A.map((row: TaxRowG18A, index) => ({
    id: `g18a-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Titular', value: row.titular },
      { label: 'País Entidade Gestora', value: row.codPaisEntGestora },
      { label: 'Data de Realização', value: formatDateParts(row.anoRealizacao, row.mesRealizacao, row.diaRealizacao) },
      { label: t('report.totals.realisation_value'), value: row.valorRealizacao, currency: true },
      { label: 'Data de Aquisição', value: formatDateParts(row.anoAquisicao, row.mesAquisicao, row.diaAquisicao) },
      { label: t('report.totals.acquisition_value'), value: row.valorAquisicao, currency: true },
      { label: t('report.totals.expenses_charges'), value: row.despesasEncargos, currency: true },
      { label: 'País da Contraparte', value: row.codPaisContraparte },
    ],
  }));

  const rowG1q7Previews: CreatedRowPreview[] = parsedData.rowsG1q7.map((row: TaxRowG1q7, index) => ({
    id: `g1q7-${index}`,
    line: t('report.created_row_label', { number: index + 1 }),
    source: row._source,
    asset: row._asset,
    fields: [
      { label: 'Titular', value: row.titular },
      { label: 'País Entidade Gestora', value: row.codPaisEntGestora },
      { label: 'Data de Realização', value: formatDateParts(row.anoRealizacao, row.mesRealizacao, row.diaRealizacao) },
      { label: t('report.totals.realisation_value'), value: row.valorRealizacao, currency: true },
      { label: 'Data de Aquisição', value: formatDateParts(row.anoAquisicao, row.mesAquisicao, row.diaAquisicao) },
      { label: t('report.totals.acquisition_value'), value: row.valorAquisicao, currency: true },
      { label: t('report.totals.expenses_charges'), value: row.despesasEncargos, currency: true },
      { label: 'País da Contraparte', value: row.codPaisContraparte },
    ],
  }));

  const annexGCards = [
    {
      id: 'g9',
      title: t('report.quadro_g9.title'),
      subtitle: t('report.quadro_g9.subtitle'),
      rowsAdded: summary.tableG9.rowsAdded,
      totals: summary.tableG9.totals,
      sources: summary.tableG9.sources,
      icon: <TrendingUp size={20} />,
      colorClass: 'enrichment-card--green',
      createdRows: rowG9Previews,
    },
    {
      id: 'g13',
      title: t('report.quadro_g13.title'),
      subtitle: t('report.quadro_g13.subtitle'),
      rowsAdded: summary.tableG13.rowsAdded,
      totals: summary.tableG13.totals,
      sources: summary.tableG13.sources,
      icon: <Activity size={20} />,
      colorClass: 'enrichment-card--blue',
      createdRows: rowG13Previews,
    },
    {
      id: 'g18a',
      title: t('report.quadro_g18a.title'),
      subtitle: t('report.quadro_g18a.subtitle'),
      rowsAdded: summary.tableG18A.rowsAdded,
      totals: summary.tableG18A.totals,
      sources: summary.tableG18A.sources,
      icon: <Coins size={20} />,
      colorClass: 'enrichment-card--orange',
      createdRows: rowG18APreviews,
    },
  ];

  const annexJCards = [
    {
      id: '8a',
      title: t('report.quadro_8a.title'),
      subtitle: t('report.quadro_8a.subtitle'),
      rowsAdded: summary.table8A.rowsAdded,
      totals: summary.table8A.totals,
      sources: summary.table8A.sources,
      icon: <Receipt size={20} />,
      colorClass: 'enrichment-card--blue',
      createdRows: row8APreviews,
    },
    {
      id: '92a',
      title: t('report.quadro_92a.title'),
      subtitle: t('report.quadro_92a.subtitle'),
      rowsAdded: summary.table92A.rowsAdded,
      totals: summary.table92A.totals,
      sources: summary.table92A.sources,
      icon: <TrendingUp size={20} />,
      colorClass: 'enrichment-card--green',
      createdRows: row92APreviews,
    },
    {
      id: '92b',
      title: t('report.quadro_92b.title'),
      subtitle: t('report.quadro_92b.subtitle'),
      rowsAdded: summary.table92B.rowsAdded,
      totals: summary.table92B.totals,
      sources: summary.table92B.sources,
      icon: <Landmark size={20} />,
      colorClass: 'enrichment-card--purple',
      createdRows: row92BPreviews,
    },
  ];
  
  const hasAnnexG = summary.tableG9.rowsAdded > 0 || summary.tableG13.rowsAdded > 0 || summary.tableG18A.rowsAdded > 0;
  const hasAnnexG1 = summary.tableG1q7.rowsAdded > 0;
  const hasAnnexJ = [summary.table8A, summary.table92A, summary.table92B].some(t => t.rowsAdded > 0);

  return (
    <div className="enrichment-report">
      <div className="enrichment-report__header">
        <CheckCircle2 size={22} className="enrichment-report__check" />
        <div>
          <h2 className="enrichment-report__title">{t('app.result.title')}</h2>
          <p className="enrichment-report__subtitle">
            {t('app.result.subtitle', { count: summary.totalRowsAdded, activeTables: activeTablesCount })}
          </p>
        </div>
      </div>

      {hasAnnexG && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_g')} <span>{t('report.capital_gains')}</span>
          </header>
          <div className="enrichment-report__grid">
            {annexGCards.map(card => (
              <TableCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      )}

      {hasAnnexG1 && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_g1')} <span>{t('report.capital_gains')}</span>
          </header>
          <div className="enrichment-report__grid">
            <TableCard
              title={t('report.quadro_g1q7.title')}
              subtitle={t('report.quadro_g1q7.subtitle')}
              rowsAdded={summary.tableG1q7.rowsAdded}
              totals={summary.tableG1q7.totals}
              sources={summary.tableG1q7.sources}
              icon={<Coins size={20} />}
              colorClass="enrichment-card--teal"
              id="g1q7"
              createdRows={rowG1q7Previews}
            />
          </div>
        </div>
      )}

      {hasAnnexJ && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_j')} <span>{t('report.foreign_income')}</span>
          </header>
          <div className="enrichment-report__grid">
            {annexJCards.map(card => (
              <TableCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
