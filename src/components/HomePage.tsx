import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Coins, Download, Eye, Info, Loader2, Upload, X } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { EnrichmentReport } from './EnrichmentReport';
import { FileUploader } from './FileUploader';
import { IrsTablesViewer } from './IrsTablesViewer';
import { NO_ROWS_FOUND_ERROR, downloadXmlFile, processBrokerFiles, processTaxFiles } from '../utils/processFiles';
import type { BrokerFilesResult } from '../utils/processFiles';
import { BrokerParsingError } from '../utils/parserErrors';
import { getBrokerBadgeMeta } from '../utils/brokerBadgeMeta';
import type { EnrichmentResult } from '../types';

type WorkflowMode = 'enrich' | 'tables';

interface BrokerUploader {
  labelKey: string;
  accept: string;
  file: File | null;
  setFile: (file: File | null) => void;
}

interface BrokerSection {
  id: string;
  badge: string;
  badgeClass: string;
  laneKey: string;
  warningKeys: string[];
  uploaders: BrokerUploader[];
}

/**
 * Home page for the IRS enrichment workflow: upload files, process data, and review outputs.
 */
export function HomePage() {
  const { t } = useTranslation();
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('enrich');
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [xtbCapitalGainsPdf, setXtbCapitalGainsPdf] = useState<File | null>(null);
  const [xtbDividendsPdf, setXtbDividendsPdf] = useState<File | null>(null);
  const [tradeRepublicPdf, setTradeRepublicPdf] = useState<File | null>(null);
  const [trading212Pdf, setTrading212Pdf] = useState<File | null>(null);
  const [activoBankPdf, setActivoBankPdf] = useState<File | null>(null);
  const [freedom24Pdf, setFreedom24Pdf] = useState<File | null>(null);
  const [ibkrPdf, setIbkrPdf] = useState<File | null>(null);
  const [degiroTransactionsCsv, setDegiroTransactionsCsv] = useState<File | null>(null);
  const [binanceTransactionsXlsx, setBinanceTransactionsXlsx] = useState<File | null>(null);
  const [revolutConsolidatedPdf, setRevolutConsolidatedPdf] = useState<File | null>(null);
  const [revolutConsolidatedCsv, setRevolutConsolidatedCsv] = useState<File | null>(null);
  const [etradeGainLossXlsx, setEtradeGainLossXlsx] = useState<File | null>(null);
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [tablesResult, setTablesResult] = useState<BrokerFilesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDonationPrompt, setShowDonationPrompt] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef<HTMLDivElement>(null);
  const donationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  useEffect(() => {
    if (tablesResult && tablesRef.current) {
      tablesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [tablesResult]);

  // Scroll-based donation trigger for tables-only mode
  const handleTablesVisible = useCallback(() => {
    if (donationTimerRef.current) return;
    donationTimerRef.current = setTimeout(() => {
      setShowDonationPrompt(true);
    }, 10_000);
  }, []);

  useEffect(() => {
    if (!tablesResult || !tablesRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          handleTablesVisible();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(tablesRef.current);

    return () => {
      observer.disconnect();
      if (donationTimerRef.current) {
        clearTimeout(donationTimerRef.current);
        donationTimerRef.current = null;
      }
    };
  }, [tablesResult, handleTablesVisible]);

  useEffect(() => {
    if (!showDonationPrompt) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDonationPrompt(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showDonationPrompt]);

  const hasBrokerFile = xtbCapitalGainsPdf || xtbDividendsPdf || tradeRepublicPdf || trading212Pdf || activoBankPdf || freedom24Pdf || ibkrPdf || degiroTransactionsCsv || binanceTransactionsXlsx || revolutConsolidatedPdf || revolutConsolidatedCsv || etradeGainLossXlsx;

  const brokerSections: BrokerSection[] = useMemo(
    () => [
      {
        id: 'xtb',
        badge: getBrokerBadgeMeta('xtb')?.shortLabel ?? 'XTB',
        badgeClass: getBrokerBadgeMeta('xtb')?.badgeClass ?? 'broker-badge--xtb',
        laneKey: 'uploader.xtb_lane',
        warningKeys: [
          'uploader.xtb_warning_1',
          'uploader.xtb_warning_2',
          'uploader.xtb_warning_3',
          'uploader.xtb_warning_4',
        ],
        uploaders: [
          {
            labelKey: 'uploader.xtb_gains',
            accept: '.pdf',
            file: xtbCapitalGainsPdf,
            setFile: setXtbCapitalGainsPdf,
          },
          {
            labelKey: 'uploader.xtb_dividends',
            accept: '.pdf',
            file: xtbDividendsPdf,
            setFile: setXtbDividendsPdf,
          },
        ],
      },
      {
        id: 'trade-republic',
        badge: getBrokerBadgeMeta('trade republic')?.shortLabel ?? 'TR',
        badgeClass: getBrokerBadgeMeta('trade republic')?.badgeClass ?? 'broker-badge--tr',
        laneKey: 'uploader.tr_lane',
        warningKeys: ['uploader.tr_warning_1', 'uploader.tr_warning_2'],
        uploaders: [
          {
            labelKey: 'uploader.tr_report',
            accept: '.pdf',
            file: tradeRepublicPdf,
            setFile: setTradeRepublicPdf,
          },
        ],
      },
      {
        id: 'trading-212',
        badge: getBrokerBadgeMeta('trading 212')?.shortLabel ?? 'T212',
        badgeClass: getBrokerBadgeMeta('trading 212')?.badgeClass ?? 'broker-badge--t212',
        laneKey: 'uploader.t212_lane',
        warningKeys: ['uploader.t212_warning_1', 'uploader.t212_warning_2'],
        uploaders: [
          {
            labelKey: 'uploader.t212_report',
            accept: '.pdf',
            file: trading212Pdf,
            setFile: setTrading212Pdf,
          },
        ],
      },
      {
        id: 'activobank',
        badge: getBrokerBadgeMeta('activobank')?.shortLabel ?? 'AB',
        badgeClass: getBrokerBadgeMeta('activobank')?.badgeClass ?? 'broker-badge--activobank',
        laneKey: 'uploader.activobank_lane',
        warningKeys: ['uploader.activobank_warning_1'],
        uploaders: [
          {
            labelKey: 'uploader.activobank_report',
            accept: '.pdf',
            file: activoBankPdf,
            setFile: setActivoBankPdf,
          },
        ],
      },
      {
        id: 'degiro',
        badge: getBrokerBadgeMeta('degiro')?.shortLabel ?? 'DEGIRO',
        badgeClass: getBrokerBadgeMeta('degiro')?.badgeClass ?? 'broker-badge--degiro',
        laneKey: 'uploader.degiro_lane',
        warningKeys: [
          'uploader.degiro_warning_1',
          'uploader.degiro_warning_2',
          'uploader.degiro_warning_3',
          'uploader.degiro_warning_4',
        ],
        uploaders: [
          {
            labelKey: 'uploader.degiro_report',
            accept: '.csv',
            file: degiroTransactionsCsv,
            setFile: setDegiroTransactionsCsv,
          },
        ],
      },
      {
        id: 'freedom24',
        badge: getBrokerBadgeMeta('freedom24')?.shortLabel ?? 'F24',
        badgeClass: getBrokerBadgeMeta('freedom24')?.badgeClass ?? 'broker-badge--freedom24',
        laneKey: 'uploader.freedom24_lane',
        warningKeys: [
          'uploader.freedom24_warning_1',
          'uploader.freedom24_warning_2',
          'uploader.freedom24_warning_3',
        ],
        uploaders: [
          {
            labelKey: 'uploader.freedom24_report',
            accept: '.pdf',
            file: freedom24Pdf,
            setFile: setFreedom24Pdf,
          },
        ],
      },
      {
        id: 'ibkr',
        badge: getBrokerBadgeMeta('ibkr')?.shortLabel ?? 'IBKR',
        badgeClass: getBrokerBadgeMeta('ibkr')?.badgeClass ?? 'broker-badge--ibkr',
        laneKey: 'uploader.ibkr_lane',
        warningKeys: [
          'warnings.ibkr_multiCurrency',
          'warnings.ibkr_adrCountry',
          'warnings.ibkr_optionsCode',
        ],
        uploaders: [
          {
            labelKey: 'uploader.ibkr_activityStatement',
            accept: '.pdf',
            file: ibkrPdf,
            setFile: setIbkrPdf,
          },
        ],
      },
      {
        id: 'binance',
        badge: getBrokerBadgeMeta('binance')?.shortLabel ?? 'BNB',
        badgeClass: getBrokerBadgeMeta('binance')?.badgeClass ?? 'broker-badge--binance',
        laneKey: 'uploader.binance_lane',
        warningKeys: [
          'uploader.binance_warning_1',
          'uploader.binance_warning_2',
          'uploader.binance_warning_3',
          'uploader.binance_warning_4',
        ],
        uploaders: [{
          labelKey: 'uploader.binance_report',
          accept: '.xlsx,.xls',
          file: binanceTransactionsXlsx,
          setFile: setBinanceTransactionsXlsx,
        }],
      },
      {
        id: 'revolut',
        badge: getBrokerBadgeMeta('revolut')?.shortLabel ?? 'REV',
        badgeClass: getBrokerBadgeMeta('revolut')?.badgeClass ?? 'broker-badge--revolut',
        laneKey: 'uploader.revolut_lane',
        warningKeys: [
          'uploader.revolut_warning_1',
          'uploader.revolut_warning_2',
          'uploader.revolut_warning_3',
          'uploader.revolut_warning_4',
        ],
        uploaders: [
          {
            labelKey: 'uploader.revolut_pdf_report',
            accept: '.pdf',
            file: revolutConsolidatedPdf,
            setFile: setRevolutConsolidatedPdf,
          },
          {
            labelKey: 'uploader.revolut_csv_report',
            accept: '.csv',
            file: revolutConsolidatedCsv,
            setFile: setRevolutConsolidatedCsv,
          },
        ],
      },
      {
        id: 'etrade',
        badge: getBrokerBadgeMeta('etrade')?.shortLabel ?? 'ET',
        badgeClass: getBrokerBadgeMeta('etrade')?.badgeClass ?? 'broker-badge--etrade',
        laneKey: 'uploader.etrade_lane',
        warningKeys: ['uploader.etrade_warning_1', 'uploader.etrade_warning_2', 'uploader.etrade_warning_3'],
        uploaders: [
          {
            labelKey: 'uploader.etrade_report',
            accept: '.xlsx',
            file: etradeGainLossXlsx,
            setFile: setEtradeGainLossXlsx,
          },
        ],
      },
    ],
    [xtbCapitalGainsPdf, xtbDividendsPdf, tradeRepublicPdf, trading212Pdf, activoBankPdf, freedom24Pdf, ibkrPdf, degiroTransactionsCsv, binanceTransactionsXlsx, revolutConsolidatedPdf, revolutConsolidatedCsv, etradeGainLossXlsx],
  );

  const visibleBrokerSections = useMemo(
    () => brokerSections.filter(section => selectedBrokerIds.includes(section.id)),
    [brokerSections, selectedBrokerIds],
  );

  const handleBrokerSelectionToggle = useCallback((brokerId: string) => {
    setSelectedBrokerIds(current => {
      if (current.includes(brokerId)) {
        const brokerSection = brokerSections.find(section => section.id === brokerId);
        brokerSection?.uploaders.forEach(uploader => uploader.setFile(null));
        return current.filter(id => id !== brokerId);
      }

      return [...current, brokerId];
    });
  }, [brokerSections]);

  const canProcess = workflowMode === 'enrich'
    ? !!xmlFile && !!hasBrokerFile
    : !!hasBrokerFile;

  const handleProcess = async () => {
    if (!canProcess) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setTablesResult(null);

    try {
      if (workflowMode === 'enrich') {
        const enrichmentResult = await processTaxFiles({
          xmlFile: xmlFile!,
          xtbCapitalGainsPdf,
          xtbDividendsPdf,
          tradeRepublicPdf,
          trading212Pdf,
          activoBankPdf,
          freedom24Pdf,
          ibkrPdf,
          degiroTransactionsCsv,
          binanceTransactionsXlsx,
          revolutConsolidatedPdf,
          revolutConsolidatedCsv,
          etradeGainLossXlsx,
        });
        setResult(enrichmentResult);
      } else {
        const brokerResult = await processBrokerFiles({
          xtbCapitalGainsPdf,
          xtbDividendsPdf,
          tradeRepublicPdf,
          trading212Pdf,
          activoBankPdf,
          freedom24Pdf,
          ibkrPdf,
          degiroTransactionsCsv,
          binanceTransactionsXlsx,
          revolutConsolidatedPdf,
          revolutConsolidatedCsv,
          etradeGainLossXlsx,
        });
        setTablesResult(brokerResult);
      }
    } catch (err: unknown) {
      console.error(err);

      if (err instanceof BrokerParsingError) {
        setError(t(err.i18nKey, err.i18nParams));
      } else if (err instanceof Error && err.message === NO_ROWS_FOUND_ERROR) {
        setError(t('app.error.no_rows'));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || t('app.error.generic'));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) {
      return;
    }

    const originalName = xmlFile?.name.replace('.xml', '') || 'irs-declaration';
    const enrichedName = `${originalName}-enriched.xml`;
    downloadXmlFile(result.enrichedXml, enrichedName);
    setShowDonationPrompt(true);
  };

  const handleReset = () => {
    setResult(null);
    setTablesResult(null);
    setError(null);
    if (donationTimerRef.current) {
      clearTimeout(donationTimerRef.current);
      donationTimerRef.current = null;
    }
  };

  const hasResult = result || tablesResult;
  const resultWarnings = result?.warnings ?? tablesResult?.warnings ?? [];

  return (
    <>
      <main className="glass-panel">
        <div className="main-panel-actions">
          <Link to="/how-it-works" className="nav-button">
            <Info size={18} />
            {t('app.how_it_works')}
          </Link>
          <a
            href="https://donate.stripe.com/00w5kEaSE3D40KEaZw8IU00"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-button bmc-button"
          >
            <Coins size={16} aria-hidden="true" />
            {t('app.bmc.button')}
          </a>
        </div>

        <div className="uploaders-container">
          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">1</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.step1_lane')}</h2>
                <p className="category-description">{t('uploader.step1_description')}</p>
              </div>
            </div>
            <div className="category-content">
              <div className="workflow-toggle">
                <button
                  className={`workflow-toggle__option ${workflowMode === 'enrich' ? 'workflow-toggle__option--active' : ''}`}
                  onClick={() => setWorkflowMode('enrich')}
                  type="button"
                >
                  <Upload size={16} />
                  {t('uploader.mode_enrich')}
                </button>
                <button
                  className={`workflow-toggle__option ${workflowMode === 'tables' ? 'workflow-toggle__option--active' : ''}`}
                  onClick={() => setWorkflowMode('tables')}
                  type="button"
                >
                  <Eye size={16} />
                  {t('uploader.mode_tables')}
                </button>
              </div>
              {workflowMode === 'enrich' && (
                <FileUploader
                  label={t('uploader.xml_file')}
                  accept=".xml"
                  onFileSelect={setXmlFile}
                  onRemove={() => setXmlFile(null)}
                />
              )}
            </div>
          </section>

          <div className="category-divider" />

          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">2</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.brokers_lane')}</h2>
                <p className="category-description">{t('uploader.brokers_description')}</p>
              </div>
            </div>
            <div className="category-content">
              <div className="broker-selector">
                <div className="broker-selector__header">
                  <p className="broker-selector__title">{t('uploader.broker_selector_title')}</p>
                  <p className="broker-selector__hint">{t('uploader.broker_selector_hint')}</p>
                </div>

                <div className="broker-selector__list">
                  {brokerSections.map(section => {
                    const isSelected = selectedBrokerIds.includes(section.id);

                    return (
                      <button
                        key={section.id}
                        type="button"
                        className={`broker-selector__option ${isSelected ? 'broker-selector__option--selected' : ''}`}
                        onClick={() => handleBrokerSelectionToggle(section.id)}
                        aria-pressed={isSelected}
                      >
                        <span className={`broker-badge ${section.badgeClass}`}>{section.badge}</span>
                        <span className="broker-selector__option-label">{t(section.laneKey)}</span>
                      </button>
                    );
                  })}
                </div>

                {visibleBrokerSections.length === 0 && (
                  <p className="broker-selector__empty">{t('uploader.broker_selector_empty')}</p>
                )}
              </div>

              {visibleBrokerSections.map(section => (
                <div className="broker-group" key={section.laneKey}>
                  <div className="broker-header">
                    <span className={`broker-badge ${section.badgeClass}`}>{section.badge}</span>
                    <span className="broker-label">{t(section.laneKey)}</span>
                    <span className="broker-optional">{t('uploader.optional')}</span>
                  </div>

                  <div className="broker-warnings">
                    <span className="broker-warnings__title">
                      <AlertTriangle size={12} />
                      {t('uploader.warnings_title')}
                    </span>
                    <ul className="broker-warnings__list">
                      {section.warningKeys.map(warningKey => (
                        <li key={warningKey}>{t(warningKey)}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="broker-files">
                    {section.uploaders.map(uploader => (
                      <FileUploader
                        key={uploader.labelKey}
                        label={t(uploader.labelKey)}
                        accept={uploader.accept}
                        onFileSelect={file => uploader.setFile(file)}
                        onRemove={() => uploader.setFile(null)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="action-area">
          {!hasResult ? (
            <button
              className="btn btn-primary"
              onClick={handleProcess}
              disabled={!canProcess || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={24} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  {t('app.process.processing')}
                </>
              ) : (
                t('app.process.button')
              )}
            </button>
          ) : (
            <div className="action-buttons">
              {result && (
                <button className="btn btn-primary" onClick={handleDownload}>
                  <Download size={20} />
                  {t('app.result.download')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={handleReset}>
                {t('app.result.start_over')}
              </button>
            </div>
          )}

          {error && (
            <div className="status-msg status-error">
              <AlertCircle size={20} />
              {error}
            </div>
          )}

          {resultWarnings.length > 0 && (
            <div className="status-msg status-warning">
              <Info size={20} style={{ flexShrink: 0 }} />
              <div>
                {resultWarnings.map((key) => (
                  <p key={key} style={{ margin: 0 }}>
                    {t(key, { fileName: binanceTransactionsXlsx?.name ?? '' })}
                  </p>
                ))}
              </div>
            </div>
          )}

          {hasResult && (
            <div className="status-msg status-warning">
              <AlertTriangle size={30} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
              {t('app.result.disclaimer')}
            </div>
          )}
        </div>
      </main>

      {result && (
        <div className="results-section" ref={resultsRef}>
          <EnrichmentReport summary={result.summary} />
          <DiffViewer originalXml={result.originalXml} enrichedXml={result.enrichedXml} />
        </div>
      )}

      {tablesResult && (
        <div className="results-section" ref={tablesRef}>
          <IrsTablesViewer parsedData={tablesResult.parsedData} sources={tablesResult.sources} />
        </div>
      )}

      {showDonationPrompt && (
        <div
          className="donation-modal-backdrop"
          onClick={() => setShowDonationPrompt(false)}
          role="presentation"
        >
          <div
            className="donation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="donation-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              className="donation-modal__close"
              onClick={() => setShowDonationPrompt(false)}
              aria-label={t('app.bmc.popup.close')}
            >
              <X size={18} />
            </button>

            <div className="donation-modal__header">
              <h2 id="donation-modal-title" className="donation-modal__title">
                {t('app.bmc.popup.title')}
              </h2>
              <p className="donation-modal__subtitle">{t('app.bmc.popup.subtitle')}</p>
            </div>

            <div className="donation-modal__actions">
              <button className="btn btn-secondary donation-modal__action" onClick={() => setShowDonationPrompt(false)}>
                {t('app.bmc.popup.close')}
              </button>
              <a
                href="https://donate.stripe.com/00w5kEaSE3D40KEaZw8IU00"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary donation-modal__action"
              >
                {t('app.bmc.popup.open_link')}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
