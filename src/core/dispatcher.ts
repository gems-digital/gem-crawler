import { CheerioCrawler, PlaywrightCrawler, log, LogLevel } from 'crawlee';
import { v4 as uuidv4 } from 'uuid';
import type { CrawlerDatabase } from '../storage/db.js';
import type { SnapshotStore } from '../storage/snapshot-store.js';
import { cleanHtmlContent } from '../extractors/cleaner.js';
import { computeContentHash } from '../extractors/hasher.js';
import type {
  RegisteredSource,
  RawDocumentV1,
  SourceTier,
} from '../types/index.js';

log.setLevel(LogLevel.INFO);

export interface CrawlJob {
  url: string;
  targetStone: string;
  source: RegisteredSource;
}

export interface CrawlEngineOptions {
  runId: string;
  concurrency?: number;
  delaySec?: number;
  force?: boolean;
  enginePreference?: 'cheerio' | 'playwright' | 'auto';
  db: CrawlerDatabase;
  snapshotStore: SnapshotStore;
}

export class CrawlDispatcher {
  private options: CrawlEngineOptions;

  constructor(options: CrawlEngineOptions) {
    this.options = options;
  }

  /**
   * Processes a list of crawl jobs using the optimal crawler engine.
   */
  async dispatch(jobs: CrawlJob[]): Promise<{
    processed: number;
    saved: number;
    skipped: number;
    failed: number;
  }> {
    const { db, runId, force, enginePreference } = this.options;
    let processed = 0;
    let saved = 0;
    let skipped = 0;
    let failed = 0;

    const cheerioJobs: CrawlJob[] = [];
    const playwrightJobs: CrawlJob[] = [];

    // Filter jobs against Cache TTL unless --force is set
    const now = new Date();
    for (const job of jobs) {
      if (!force) {
        const cached = db.checkUrlCache(job.url);
        if (cached && new Date(cached.expires_at) > now) {
          skipped++;
          continue;
        }
      }

      // Determine engine
      const preferred = enginePreference || job.source.engine || 'auto';
      if (preferred === 'playwright') {
        playwrightJobs.push(job);
      } else {
        cheerioJobs.push(job);
      }
    }

    if (skipped > 0) {
      db.updateRunStats(runId, { total_skipped: skipped });
      console.log(`[Cache] Skipped ${skipped} URLs because their TTL is still fresh.`);
    }

    // Run Cheerio Crawler for lightweight / static jobs
    if (cheerioJobs.length > 0) {
      const res = await this.runCheerioCrawler(cheerioJobs);
      processed += res.processed;
      saved += res.saved;
      failed += res.failed;
    }

    // Run Playwright Crawler for dynamic / JS-heavy jobs
    if (playwrightJobs.length > 0) {
      const res = await this.runPlaywrightCrawler(playwrightJobs);
      processed += res.processed;
      saved += res.saved;
      failed += res.failed;
    }

    return { processed, saved, skipped, failed };
  }

  private async runCheerioCrawler(jobs: CrawlJob[]): Promise<{
    processed: number;
    saved: number;
    failed: number;
  }> {
    const { db, snapshotStore, runId } = this.options;
    let processed = 0;
    let saved = 0;
    let failed = 0;

    const jobMap = new Map<string, CrawlJob>();
    for (const j of jobs) {
      jobMap.set(j.url, j);
    }

    const crawler = new CheerioCrawler({
      maxConcurrency: this.options.concurrency || 5,
      sameDomainDelaySecs: this.options.delaySec || 1.5,
      maxRequestRetries: 3,
      requestHandlerTimeoutSecs: 30,

      preNavigationHooks: [
        async ({ request }) => {
          request.headers = {
            ...request.headers,
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (compatible; OmniGemBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          };
        },
      ],

      async requestHandler({ request, response, body, $ }) {
        const job = jobMap.get(request.url);
        if (!job) return;

        processed++;
        const rawHtml = typeof body === 'string' ? body : body.toString('utf8');
        const statusCode = response.statusCode || 200;

        // Clean & parse text
        const cleanResult = cleanHtmlContent(rawHtml, job.source);
        const contentHash = computeContentHash(cleanResult.cleanedText);

        // Check if content hash changed compared to cache
        const prevCache = db.checkUrlCache(request.loadedUrl || request.url);
        const ttlDays = job.source.ttl_days || 30;
        const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

        if (prevCache && prevCache.content_hash === contentHash && !prevCache.etag) {
          // Unchanged content, update expiration
          db.updateUrlCache({
            canonical_url: request.loadedUrl || request.url,
            content_hash: contentHash,
            last_crawled_at: new Date().toISOString(),
            expires_at: expiresAt,
            last_status_code: statusCode,
            source_tier: job.source.tier,
          });
          return;
        }

        // Save raw compressed snapshot
        const snapshot = await snapshotStore.saveSnapshot(
          rawHtml,
          job.source.tier,
          job.targetStone,
          contentHash
        );

        const rawDoc: RawDocumentV1 = {
          schema_version: '1.0.0',
          id: uuidv4(),
          run_id: runId,
          target_stone: job.targetStone,
          source_tier: job.source.tier,
          original_url: job.url,
          canonical_url: request.loadedUrl || request.url,
          crawl_timestamp: new Date().toISOString(),
          http_status: statusCode,
          response_headers: response.headers as Record<string, string | undefined>,
          page_title: cleanResult.title || $('title').text().trim(),
          content_hash: contentHash,
          raw_html_path: snapshot.relativePath,
          raw_html_size_bytes: snapshot.rawSizeBytes,
          compressed_size_bytes: snapshot.compressedSizeBytes,
          cleaned_text: cleanResult.cleanedText,
          cleaned_markdown: cleanResult.cleanedMarkdown,
          extractor_metadata: {
            engine: 'cheerio',
            strategy: cleanResult.strategy,
            word_count: cleanResult.wordCount,
            character_count: cleanResult.characterCount,
          },
        };

        db.saveDocument(rawDoc, expiresAt);
        db.updateUrlCache({
          canonical_url: request.loadedUrl || request.url,
          etag: (response.headers['etag'] as string) || undefined,
          last_modified: (response.headers['last-modified'] as string) || undefined,
          content_hash: contentHash,
          last_crawled_at: new Date().toISOString(),
          expires_at: expiresAt,
          last_status_code: statusCode,
          source_tier: job.source.tier,
        });

        saved++;
        db.updateRunStats(runId, { total_processed: 1, total_new: 1 });
      },

      failedRequestHandler({ request }, error) {
        failed++;
        const job = jobMap.get(request.url);
        db.recordError(
          uuidv4(),
          runId,
          request.url,
          job?.targetStone || null,
          error.message,
          error.stack || null,
          request.retryCount
        );
        db.updateRunStats(runId, { total_failed: 1 });
      },
    });

    await crawler.run(jobs.map((j) => j.url));
    return { processed, saved, failed };
  }

  private async runPlaywrightCrawler(jobs: CrawlJob[]): Promise<{
    processed: number;
    saved: number;
    failed: number;
  }> {
    const { db, snapshotStore, runId } = this.options;
    let processed = 0;
    let saved = 0;
    let failed = 0;

    const jobMap = new Map<string, CrawlJob>();
    for (const j of jobs) {
      jobMap.set(j.url, j);
    }

    const crawler = new PlaywrightCrawler({
      maxConcurrency: Math.min(this.options.concurrency || 2, 3),
      sameDomainDelaySecs: this.options.delaySec || 2.5,
      maxRequestRetries: 2,
      requestHandlerTimeoutSecs: 45,

      // Block images, fonts and media to save bandwidth & CPU
      preNavigationHooks: [
        async ({ page }) => {
          await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,webm}', (route) =>
            route.abort()
          );
        },
      ],

      async requestHandler({ request, page, response }) {
        const job = jobMap.get(request.url);
        if (!job) return;

        processed++;
        const rawHtml = await page.content();
        const statusCode = response ? response.status() : 200;
        const pageTitle = await page.title();

        const cleanResult = cleanHtmlContent(rawHtml, job.source);
        const contentHash = computeContentHash(cleanResult.cleanedText);

        const ttlDays = job.source.ttl_days || 30;
        const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

        const snapshot = await snapshotStore.saveSnapshot(
          rawHtml,
          job.source.tier,
          job.targetStone,
          contentHash
        );

        const rawDoc: RawDocumentV1 = {
          schema_version: '1.0.0',
          id: uuidv4(),
          run_id: runId,
          target_stone: job.targetStone,
          source_tier: job.source.tier,
          original_url: job.url,
          canonical_url: page.url(),
          crawl_timestamp: new Date().toISOString(),
          http_status: statusCode,
          page_title: pageTitle || cleanResult.title,
          content_hash: contentHash,
          raw_html_path: snapshot.relativePath,
          raw_html_size_bytes: snapshot.rawSizeBytes,
          compressed_size_bytes: snapshot.compressedSizeBytes,
          cleaned_text: cleanResult.cleanedText,
          cleaned_markdown: cleanResult.cleanedMarkdown,
          extractor_metadata: {
            engine: 'playwright',
            strategy: cleanResult.strategy,
            word_count: cleanResult.wordCount,
            character_count: cleanResult.characterCount,
          },
        };

        db.saveDocument(rawDoc, expiresAt);
        db.updateUrlCache({
          canonical_url: page.url(),
          content_hash: contentHash,
          last_crawled_at: new Date().toISOString(),
          expires_at: expiresAt,
          last_status_code: statusCode,
          source_tier: job.source.tier,
        });

        saved++;
        db.updateRunStats(runId, { total_processed: 1, total_new: 1 });
      },

      failedRequestHandler({ request }, error) {
        failed++;
        const job = jobMap.get(request.url);
        db.recordError(
          uuidv4(),
          runId,
          request.url,
          job?.targetStone || null,
          error.message,
          error.stack || null,
          request.retryCount
        );
        db.updateRunStats(runId, { total_failed: 1 });
      },
    });

    await crawler.run(jobs.map((j) => j.url));
    return { processed, saved, failed };
  }
}
