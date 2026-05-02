export interface BrokerBadgeMeta {
  shortLabel: string;
  badgeClass: string;
  sourceTagClass: string;
}

const BROKER_BADGE_META: Array<{ match: (source: string) => boolean; meta: BrokerBadgeMeta }> = [
  {
    match: source => source.includes('xtb'),
    meta: {
      shortLabel: 'XTB',
      badgeClass: 'broker-badge--xtb',
      sourceTagClass: 'enrichment-card__source-tag--xtb',
    },
  },
  {
    match: source => source.includes('trade republic'),
    meta: {
      shortLabel: 'TR',
      badgeClass: 'broker-badge--tr',
      sourceTagClass: 'enrichment-card__source-tag--trade-republic',
    },
  },
  {
    match: source => source.includes('trading 212'),
    meta: {
      shortLabel: 'T212',
      badgeClass: 'broker-badge--t212',
      sourceTagClass: 'enrichment-card__source-tag--t212',
    },
  },
  {
    match: source => source.includes('activobank'),
    meta: {
      shortLabel: 'AB',
      badgeClass: 'broker-badge--activobank',
      sourceTagClass: 'enrichment-card__source-tag--activobank',
    },
  },
  {
    match: source => source.includes('degiro'),
    meta: {
      shortLabel: 'DEGIRO',
      badgeClass: 'broker-badge--degiro',
      sourceTagClass: 'enrichment-card__source-tag--degiro',
    },
  },
  {
    match: source => source.includes('freedom24'),
    meta: {
      shortLabel: 'F24',
      badgeClass: 'broker-badge--freedom24',
      sourceTagClass: 'enrichment-card__source-tag--freedom24',
    },
  },
  {
    match: source => source.includes('ibkr') || source.includes('interactive brokers'),
    meta: {
      shortLabel: 'IBKR',
      badgeClass: 'broker-badge--ibkr',
      sourceTagClass: 'enrichment-card__source-tag--ibkr',
    },
  },
  {
    match: source => source.includes('binance'),
    meta: {
      shortLabel: 'BNB',
      badgeClass: 'broker-badge--binance',
      sourceTagClass: 'enrichment-card__source-tag--binance',
    },
  },
  {
    match: source => source.includes('revolut'),
    meta: {
      shortLabel: 'REV',
      badgeClass: 'broker-badge--revolut',
      sourceTagClass: 'enrichment-card__source-tag--revolut',
    },
  },
  {
    match: source => source.includes('e*trade') || source.includes('etrade'),
    meta: {
      shortLabel: 'ET',
      badgeClass: 'broker-badge--etrade',
      sourceTagClass: 'enrichment-card__source-tag--etrade',
    },
  },
];

export function getBrokerBadgeMeta(source: string): BrokerBadgeMeta | null {
  const normalizedSource = source.toLowerCase();
  const match = BROKER_BADGE_META.find(entry => entry.match(normalizedSource));
  return match?.meta ?? null;
}