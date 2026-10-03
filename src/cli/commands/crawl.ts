import { Command } from 'commander';
import { CrawlerDatabase } from '../../storage/db.js';
import { SnapshotStore } from '../../storage/snapshot-store.js';
import { CrawlerOrchestrator } from '../../core/crawler.js';

export function makeCrawlCommand(): Command {
  const cmd = new Command('crawl');

  cmd
    .description('Khởi chạy phiên batch crawl thu thập dữ liệu web')
    .option('-s, --stone <slug>', 'Chỉ định mã slug của loại đá cần crawl (vd: thach-anh-hong)')
    .option('-t, --tier <numbers>', 'Lọc theo tầng nguồn (vd: "1" hoặc "1,2")')
    .option('--in-stock-only', 'Chỉ crawl các loại đá đang có hàng sẵn tại cửa hàng')
    .option('-f, --force', 'Bỏ qua cache TTL và ETag, buộc crawl lại')
    .option('-c, --concurrency <number>', 'Số lượng request song song (mặc định: 5)', parseInt)
    .option('-d, --delay <seconds>', 'Thời gian nghỉ tối thiểu giữa các request cùng domain (mặc định: 1.5s)', parseFloat)
    .option('--dry-run', 'Chỉ in danh sách URL cần crawl mà không tải dữ liệu')
    .option('--engine <engine>', 'Chọn crawler engine ("cheerio", "playwright", "auto")', 'auto')
    .action(async (opts) => {
      const db = new CrawlerDatabase();
      const snapshotStore = new SnapshotStore();
      const orchestrator = new CrawlerOrchestrator(db, snapshotStore);

      try {
        await orchestrator.run({
          stone: opts.stone,
          tier: opts.tier,
          inStockOnly: opts.inStockOnly,
          force: opts.force,
          concurrency: opts.concurrency,
          delay: opts.delay,
          dryRun: opts.dryRun,
          engine: opts.engine,
        });
      } finally {
        db.close();
      }
    });

  return cmd;
}
