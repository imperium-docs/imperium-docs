export type SignalType = "IPO" | "BILLIONAIRE" | "REVENUE_RECORD";

export type SourceKind =
  | "primary"
  | "secondary"
  | "research"
  | "data_vendor"
  | "issuer_ir";

export type FeedSource = {
  url: string;
  domain: string;
  kind: SourceKind;
  weight: number;
  published_at?: string;
};

export type FeedEntities = {
  name: string;
  type: "person" | "company";
  sector: string;
  geography?: string;
};

export type FeedMetrics = {
  amount_usd?: number;
  revenue_usd?: number;
  revenue_period?: string;
  ipo_raise_usd?: number;
  valuation_usd?: number;
};

export type FeedItem = {
  id: string;
  signal_type: SignalType;
  category_label: string;
  title: string;
  summary: string;
  body: string;
  sector: string;
  canonical_url: string;
  source_name: string;
  og_image?: string;
  excerpt?: string;
  facts: string[];
  entities: FeedEntities;
  metrics: FeedMetrics;
  published_at: string;
  event_date?: string;
  sources: FeedSource[];
};

export type FeedPayload = {
  version: number;
  generated_at: string;
  items: FeedItem[];
};

export type FeedStateEntry = {
  url: string;
  id: string;
  added_at: string;
  published_at?: string;
};

export type FeedState = {
  version: number;
  updated_at: string;
  entries: FeedStateEntry[];
};
