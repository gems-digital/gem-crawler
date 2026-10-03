import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type {
  RawDocumentV1,
  CrawlRun,
  UrlCacheEntry,
  RegisteredSource,
} from '../types/index.js';

export class CrawlerDatabase {
  public db: Database.Database;

  constructor(dbPath: string = path.resolve(process.cwd(), 'data', 'crawler.db')) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crawl_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        command_args TEXT,
        status TEXT NOT NULL CHECK(status IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED')),
        total_processed INTEGER DEFAULT 0,
        total_new INTEGER DEFAULT 0,
        total_updated INTEGER DEFAULT 0,
        total_skipped INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS registered_sources (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        source_tier INTEGER NOT NULL CHECK(source_tier IN (1, 2, 3)),
        category TEXT NOT NULL,
        engine_preference TEXT DEFAULT 'auto',
        rate_limit_delay_ms INTEGER DEFAULT 1500,
        ttl_days INTEGER DEFAULT 30,
        selectors TEXT,
        search_template TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS raw_documents (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES crawl_runs(id),
        target_stone TEXT NOT NULL,
        source_tier INTEGER NOT NULL CHECK(source_tier IN (1, 2, 3)),
        canonical_url TEXT NOT NULL,
        original_url TEXT NOT NULL,
        crawl_timestamp TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        page_title TEXT,
        content_hash TEXT NOT NULL,
        raw_html_path TEXT NOT NULL,
        raw_html_size_bytes INTEGER,
        compressed_size_bytes INTEGER,
        cleaned_text TEXT NOT NULL,
        cleaned_markdown TEXT,
        extractor_metadata TEXT,
        response_headers TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS url_cache (
        canonical_url TEXT PRIMARY KEY,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT,
        last_crawled_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_status_code INTEGER NOT NULL,
        source_tier INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_errors (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES crawl_runs(id),
        url TEXT NOT NULL,
        target_stone TEXT,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        retry_count INTEGER DEFAULT 0,
        failed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_raw_docs_stone ON raw_documents(target_stone);
      CREATE INDEX IF NOT EXISTS idx_raw_docs_tier ON raw_documents(source_tier);
      CREATE INDEX IF NOT EXISTS idx_raw_docs_hash ON raw_documents(content_hash);
      CREATE INDEX IF NOT EXISTS idx_raw_docs_run ON raw_documents(run_id);
      CREATE INDEX IF NOT EXISTS idx_url_cache_expires ON url_cache(expires_at);
    `);
  }

  createRun(id: string, commandArgs: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO crawl_runs (id, started_at, command_args, status)
      VALUES (?, ?, ?, 'RUNNING')
    `);
    stmt.run(id, new Date().toISOString(), JSON.stringify(commandArgs));
  }

  updateRunStats(
    id: string,
    stats: {
      total_processed?: number;
      total_new?: number;
      total_updated?: number;
      total_skipped?: number;
      total_failed?: number;
    }
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, val] of Object.entries(stats)) {
      if (val !== undefined) {
        fields.push(`${key} = ${key} + ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    const sql = `UPDATE crawl_runs SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  finishRun(id: string, status: 'COMPLETED' | 'FAILED' | 'ABORTED'): void {
    const stmt = this.db.prepare(`
      UPDATE crawl_runs
      SET finished_at = ?, status = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), status, id);
  }

  getRun(id: string): CrawlRun | null {
    const stmt = this.db.prepare(`SELECT * FROM crawl_runs WHERE id = ?`);
    return (stmt.get(id) as CrawlRun) || null;
  }

  getLatestRun(): CrawlRun | null {
    const stmt = this.db.prepare(`
      SELECT * FROM crawl_runs
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return (stmt.get() as CrawlRun) || null;
  }

  checkUrlCache(canonicalUrl: string): UrlCacheEntry | null {
    const stmt = this.db.prepare(`SELECT * FROM url_cache WHERE canonical_url = ?`);
    return (stmt.get(canonicalUrl) as UrlCacheEntry) || null;
  }

  updateUrlCache(entry: UrlCacheEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO url_cache (
        canonical_url, etag, last_modified, content_hash,
        last_crawled_at, expires_at, last_status_code, source_tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_url) DO UPDATE SET
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        content_hash = excluded.content_hash,
        last_crawled_at = excluded.last_crawled_at,
        expires_at = excluded.expires_at,
        last_status_code = excluded.last_status_code,
        source_tier = excluded.source_tier
    `);
    stmt.run(
      entry.canonical_url,
      entry.etag || null,
      entry.last_modified || null,
      entry.content_hash || null,
      entry.last_crawled_at,
      entry.expires_at,
      entry.last_status_code,
      entry.source_tier
    );
  }

  saveDocument(doc: RawDocumentV1, expiresAt: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO raw_documents (
        id, run_id, target_stone, source_tier, canonical_url, original_url,
        crawl_timestamp, http_status, page_title, content_hash, raw_html_path,
        raw_html_size_bytes, compressed_size_bytes, cleaned_text, cleaned_markdown,
        extractor_metadata, response_headers, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.id,
      doc.run_id,
      doc.target_stone,
      doc.source_tier,
      doc.canonical_url,
      doc.original_url,
      doc.crawl_timestamp,
      doc.http_status,
      doc.page_title,
      doc.content_hash,
      doc.raw_html_path,
      doc.raw_html_size_bytes || 0,
      doc.compressed_size_bytes || 0,
      doc.cleaned_text,
      doc.cleaned_markdown || null,
      JSON.stringify(doc.extractor_metadata),
      JSON.stringify(doc.response_headers || {}),
      new Date().toISOString(),
      expiresAt
    );
  }

  recordError(
    id: string,
    runId: string,
    url: string,
    targetStone: string | null,
    errorMessage: string,
    errorStack: string | null,
    retryCount: number = 0
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO crawl_errors (
        id, run_id, url, target_stone, error_message, error_stack, retry_count, failed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      runId,
      url,
      targetStone,
      errorMessage,
      errorStack,
      retryCount,
      new Date().toISOString()
    );
  }

  getDocuments(filter?: {
    stone?: string;
    tier?: number;
    runId?: string;
  }): RawDocumentV1[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.stone) {
      conditions.push('target_stone = ?');
      params.push(filter.stone);
    }
    if (filter?.tier) {
      conditions.push('source_tier = ?');
      params.push(filter.tier);
    }
    if (filter?.runId) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM raw_documents ${whereClause} ORDER BY crawl_timestamp DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      schema_version: '1.0.0',
      id: row.id as string,
      run_id: row.run_id as string,
      target_stone: row.target_stone as string,
      source_tier: row.source_tier as 1 | 2 | 3,
      original_url: row.original_url as string,
      canonical_url: row.canonical_url as string,
      crawl_timestamp: row.crawl_timestamp as string,
      http_status: Number(row.http_status),
      response_headers: row.response_headers
        ? JSON.parse(row.response_headers as string)
        : {},
      page_title: (row.page_title as string) || '',
      content_hash: row.content_hash as string,
      raw_html_path: row.raw_html_path as string,
      raw_html_size_bytes: Number(row.raw_html_size_bytes || 0),
      compressed_size_bytes: Number(row.compressed_size_bytes || 0),
      cleaned_text: (row.cleaned_text as string) || '',
      cleaned_markdown: (row.cleaned_markdown as string) || undefined,
      extractor_metadata: row.extractor_metadata
        ? JSON.parse(row.extractor_metadata as string)
        : { engine: 'cheerio', strategy: 'fallback', word_count: 0 },
    }));
  }

  getDocumentById(id: string): RawDocumentV1 | null {
    const stmt = this.db.prepare(`SELECT * FROM raw_documents WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      schema_version: '1.0.0',
      id: row.id as string,
      run_id: row.run_id as string,
      target_stone: row.target_stone as string,
      source_tier: row.source_tier as 1 | 2 | 3,
      original_url: row.original_url as string,
      canonical_url: row.canonical_url as string,
      crawl_timestamp: row.crawl_timestamp as string,
      http_status: Number(row.http_status),
      response_headers: row.response_headers
        ? JSON.parse(row.response_headers as string)
        : {},
      page_title: (row.page_title as string) || '',
      content_hash: row.content_hash as string,
      raw_html_path: row.raw_html_path as string,
      raw_html_size_bytes: Number(row.raw_html_size_bytes || 0),
      compressed_size_bytes: Number(row.compressed_size_bytes || 0),
      cleaned_text: (row.cleaned_text as string) || '',
      cleaned_markdown: (row.cleaned_markdown as string) || undefined,
      extractor_metadata: row.extractor_metadata
        ? JSON.parse(row.extractor_metadata as string)
        : { engine: 'cheerio', strategy: 'fallback', word_count: 0 },
    };
  }

  syncSources(sources: RegisteredSource[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO registered_sources (
        id, domain, name, source_tier, category, engine_preference,
        rate_limit_delay_ms, ttl_days, selectors, search_template, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        name = excluded.name,
        source_tier = excluded.source_tier,
        category = excluded.category,
        engine_preference = excluded.engine_preference,
        rate_limit_delay_ms = excluded.rate_limit_delay_ms,
        ttl_days = excluded.ttl_days,
        selectors = excluded.selectors,
        search_template = excluded.search_template
    `);

    const now = new Date().toISOString();
    for (const src of sources) {
      stmt.run(
        src.id,
        src.domain,
        src.name,
        src.tier,
        src.category,
        src.engine || 'auto',
        src.rate_limit_delay_ms || 1500,
        src.ttl_days || 30,
        src.selectors ? JSON.stringify(src.selectors) : null,
        src.search_template || null,
        now
      );
    }
  }

  getRegisteredSources(): RegisteredSource[] {
    const stmt = this.db.prepare(`SELECT * FROM registered_sources WHERE is_active = 1`);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      domain: r.domain as string,
      name: r.name as string,
      tier: r.source_tier as 1 | 2 | 3,
      category: r.category as string,
      engine: (r.engine_preference as 'cheerio' | 'playwright' | 'auto') || 'auto',
      rate_limit_delay_ms: Number(r.rate_limit_delay_ms || 1500),
      ttl_days: Number(r.ttl_days || 30),
      selectors: r.selectors ? JSON.parse(r.selectors as string) : undefined,
      search_template: (r.search_template as string) || undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
