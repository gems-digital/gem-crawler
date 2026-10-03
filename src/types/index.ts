export type SourceTier = 1 | 2 | 3;

export interface ExtractorMetadata {
  engine: 'cheerio' | 'playwright';
  strategy: 'readability-linkedom' | 'domain-selector' | 'fallback';
  word_count: number;
  character_count?: number;
  language_detected?: string;
  execution_duration_ms?: number;
}

export interface RawDocumentV1 {
  schema_version: '1.0.0';
  id: string; // UUID v4
  run_id: string; // UUID v4
  target_stone: string; // slug, e.g. "thach-anh-hong"
  source_tier: SourceTier; // 1 | 2 | 3
  original_url: string;
  canonical_url: string;
  crawl_timestamp: string; // ISO 8601 UTC
  http_status: number;
  response_headers?: {
    etag?: string;
    'last-modified'?: string;
    'content-type'?: string;
    [header: string]: string | undefined;
  };
  page_title: string;
  content_hash: string; // SHA-256 hex string (64 characters)
  raw_html_path: string; // relative path to compressed snapshot file
  raw_html_size_bytes?: number;
  compressed_size_bytes?: number;
  cleaned_text: string;
  cleaned_markdown?: string;
  extractor_metadata: ExtractorMetadata;
}

export interface RegisteredSource {
  id: string;
  name: string;
  domain: string;
  tier: SourceTier;
  category: 'scientific' | 'vietnamese-feng-shui' | 'qa-forum' | string;
  engine?: 'cheerio' | 'playwright' | 'auto';
  rate_limit_delay_ms?: number;
  ttl_days?: number;
  selectors?: {
    article?: string;
    remove?: string[];
  };
  search_template?: string;
}

export interface SeedStone {
  slug: string;
  primary_name: string;
  aliases: string[];
  in_stock: boolean;
  priority: number;
  search_keywords: string[];
}

export interface CrawlRun {
  id: string;
  started_at: string;
  finished_at?: string;
  command_args: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  total_processed: number;
  total_new: number;
  total_updated: number;
  total_skipped: number;
  total_failed: number;
}

export interface UrlCacheEntry {
  canonical_url: string;
  etag?: string;
  last_modified?: string;
  content_hash?: string;
  last_crawled_at: string;
  expires_at: string;
  last_status_code: number;
  source_tier: SourceTier;
}
