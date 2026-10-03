import { v4 as uuidv4 } from 'uuid';
import type { CrawlerDatabase } from '../storage/db.js';
import type { SnapshotStore } from '../storage/snapshot-store.js';
import { CrawlDispatcher, type CrawlJob } from './dispatcher.js';
import { loadSourcesConfig, loadSeedStonesConfig } from '../config/index.js';
import type { RegisteredSource, SeedStone, SourceTier } from '../types/index.js';

export interface RunCrawlOptions {
  stone?: string;
  tier?: string;
  inStockOnly?: boolean;
  force?: boolean;
  concurrency?: number;
  delay?: number;
  dryRun?: boolean;
  engine?: 'cheerio' | 'playwright' | 'auto';
}

export class CrawlerOrchestrator {
  private db: CrawlerDatabase;
  private snapshotStore: SnapshotStore;

  constructor(db: CrawlerDatabase, snapshotStore: SnapshotStore) {
    this.db = db;
    this.snapshotStore = snapshotStore;
  }

  async run(options: RunCrawlOptions): Promise<void> {
    const runId = uuidv4();
    console.log(`\n======================================================`);
    console.log(`🚀 Starting Crawl Run: ${runId}`);
    console.log(`======================================================`);

    // 1. Load configs
    const sources = await loadSourcesConfig();
    const seedStones = await loadSeedStonesConfig();

    this.db.syncSources(sources);

    // 2. Filter stones
    let targetStones = seedStones;
    if (options.stone) {
      targetStones = targetStones.filter((s) => s.slug === options.stone);
      if (targetStones.length === 0) {
        console.error(`❌ Stone with slug "${options.stone}" not found in config/seed-stones.json.`);
        return;
      }
    }

    if (options.inStockOnly) {
      targetStones = targetStones.filter((s) => s.in_stock);
      console.log(`📦 Filtering in-stock stones only: ${targetStones.length} stones matching.`);
    }

    // 3. Filter tiers
    let allowedTiers: SourceTier[] = [1, 2, 3];
    if (options.tier) {
      const parsed = options.tier.split(',').map((t) => Number(t.trim()) as SourceTier);
      allowedTiers = parsed.filter((t) => [1, 2, 3].includes(t));
      console.log(`🎯 Targeting source tiers: [${allowedTiers.join(', ')}]`);
    }

    const filteredSources = sources.filter((s) => allowedTiers.includes(s.tier));

    // 4. Generate URL jobs
    const jobs: CrawlJob[] = [];
    for (const stone of targetStones) {
      for (const source of filteredSources) {
        const url = this.generateSourceUrl(source, stone);
        if (url) {
          jobs.push({
            url,
            targetStone: stone.slug,
            source,
          });
        }
      }
    }

    console.log(`📋 Total candidates planned: ${jobs.length} URLs across ${targetStones.length} stones.`);

    if (options.dryRun) {
      console.log(`\n🔍 [Dry Run] Planned URLs:`);
      for (const j of jobs) {
        const cached = this.db.checkUrlCache(j.url);
        const status = cached ? `(Cached, expires: ${cached.expires_at})` : '(New)';
        console.log(`  - [Tier ${j.source.tier} | ${j.targetStone}] ${j.url} ${status}`);
      }
      console.log(`\nDry run completed. No network requests made.`);
      return;
    }

    // 5. Initialize Run in SQLite
    this.db.createRun(runId, options as unknown as Record<string, unknown>);

    const dispatcher = new CrawlDispatcher({
      runId,
      concurrency: options.concurrency,
      delaySec: options.delay,
      force: options.force,
      enginePreference: options.engine,
      db: this.db,
      snapshotStore: this.snapshotStore,
    });

    try {
      const summary = await dispatcher.dispatch(jobs);
      this.db.finishRun(runId, 'COMPLETED');

      console.log(`\n======================================================`);
      console.log(`✅ Crawl Run Finished: ${runId}`);
      console.log(`- Processed : ${summary.processed}`);
      console.log(`- Saved New : ${summary.saved}`);
      console.log(`- Skipped   : ${summary.skipped}`);
      console.log(`- Failed    : ${summary.failed}`);
      console.log(`======================================================\n`);
    } catch (err) {
      this.db.finishRun(runId, 'FAILED');
      console.error(`❌ Crawl Run Aborted with Error:`, err);
    }
  }

  private generateSourceUrl(source: RegisteredSource, stone: SeedStone): string | null {
    const isEnglishSource =
      source.domain.startsWith('en.') ||
      source.domain.includes('mindat.org') ||
      source.domain.includes('gia.edu');

    const englishAlias = stone.aliases.find((a) => /^[A-Za-z\s]+$/.test(a)) || stone.slug;
    const targetName = isEnglishSource ? englishAlias : stone.primary_name;

    if (source.search_template) {
      const keyword = encodeURIComponent(targetName);
      return source.search_template.replace('{keyword}', keyword);
    }

    if (source.domain === 'vi.wikipedia.org') {
      const stoneWikiTitle = encodeURIComponent(stone.primary_name.replace(/ /g, '_'));
      return `https://vi.wikipedia.org/wiki/${stoneWikiTitle}`;
    }

    if (source.domain === 'en.wikipedia.org') {
      const wikiTitle = encodeURIComponent(englishAlias.replace(/ /g, '_'));
      return `https://en.wikipedia.org/wiki/${wikiTitle}`;
    }

    return null;
  }
}
