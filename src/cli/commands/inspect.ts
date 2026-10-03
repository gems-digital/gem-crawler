import { Command } from 'commander';
import { CrawlerDatabase } from '../../storage/db.js';
import { SnapshotStore } from '../../storage/snapshot-store.js';

export function makeInspectCommand(): Command {
  const cmd = new Command('inspect');
  cmd.description('Kiểm tra chi tiết một tài liệu đã crawl (xem text, markdown, snapshot)');

  cmd
    .option('--id <uuid>', 'ID của tài liệu cần kiểm tra')
    .option('--stone <slug>', 'Lọc theo slug đá')
    .option('--format <format>', 'Định dạng hiển thị ("text", "markdown", "json", "html")', 'text')
    .action(async (opts) => {
      const db = new CrawlerDatabase();
      const snapshotStore = new SnapshotStore();

      try {
        let docs = [];
        if (opts.id) {
          const doc = db.getDocumentById(opts.id);
          if (doc) docs.push(doc);
        } else if (opts.stone) {
          docs = db.getDocuments({ stone: opts.stone });
        } else {
          docs = db.getDocuments();
        }

        if (docs.length === 0) {
          console.log('Không tìm thấy tài liệu phù hợp.');
          return;
        }

        const targetDoc = docs[0];
        console.log(`\n======================================================`);
        console.log(`📄 Document: ${targetDoc.id}`);
        console.log(`- Target Stone : ${targetDoc.target_stone}`);
        console.log(`- Source Tier  : Tier ${targetDoc.source_tier}`);
        console.log(`- URL          : ${targetDoc.canonical_url}`);
        console.log(`- Crawled At   : ${targetDoc.crawl_timestamp}`);
        console.log(`- Content Hash : ${targetDoc.content_hash}`);
        console.log(`- Raw Snapshot : ${targetDoc.raw_html_path}`);
        console.log(`======================================================\n`);

        if (opts.format === 'json') {
          console.log(JSON.stringify(targetDoc, null, 2));
        } else if (opts.format === 'markdown') {
          console.log(targetDoc.cleaned_markdown || '(Không có định dạng markdown)');
        } else if (opts.format === 'html') {
          const html = await snapshotStore.readSnapshot(targetDoc.raw_html_path);
          console.log(html.slice(0, 2000) + '...\n[HTML truncated]');
        } else {
          console.log(targetDoc.cleaned_text.slice(0, 1500) + '...\n');
        }
      } finally {
        db.close();
      }
    });

  return cmd;
}
