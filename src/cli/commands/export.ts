import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CrawlerDatabase } from '../../storage/db.js';

export function makeExportCommand(): Command {
  const cmd = new Command('export');
  cmd.description('Đóng gói và xuất dữ liệu RawDocument bàn giao cho gem-data-processing');

  cmd
    .option('--run-id <uuid>', 'Chỉ xuất dữ liệu của một run_id cụ thể (hoặc "latest")')
    .option('--stone <slug>', 'Lọc theo slug đá')
    .option('--output <path>', 'Đường dẫn file xuất ra (.ndjson hoặc .json)')
    .action(async (opts) => {
      const db = new CrawlerDatabase();

      try {
        let runId = opts.runId;
        if (runId === 'latest') {
          const latestRun = db.getLatestRun();
          if (!latestRun) {
            console.error('Không tìm thấy phiên chạy crawl nào.');
            return;
          }
          runId = latestRun.id;
          console.log(`📌 Using latest run_id: ${runId}`);
        }

        const docs = db.getDocuments({
          runId,
          stone: opts.stone,
        });

        if (docs.length === 0) {
          console.log('Không có tài liệu nào để xuất.');
          return;
        }

        const exportDir = path.resolve(process.cwd(), 'exports');
        await fs.mkdir(exportDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const outputPath = opts.output
          ? path.resolve(process.cwd(), opts.output)
          : path.join(exportDir, `raw_export_${dateStr}_${runId ? runId.slice(0, 8) : 'all'}.ndjson`);

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        const ndjsonLines = docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
        await fs.writeFile(outputPath, ndjsonLines, 'utf8');

        // Copy JSON schema alongside export for contract validation by gem-data-processing [HLD p.5]
        const schemaSrc = path.resolve(process.cwd(), 'schemas', 'raw-document.schema.json');
        const schemaDestDir = path.join(path.dirname(outputPath), 'schemas');
        await fs.mkdir(schemaDestDir, { recursive: true });
        const schemaDest = path.join(schemaDestDir, 'raw-document.schema.json');
        await fs.copyFile(schemaSrc, schemaDest);

        console.log(`\n======================================================`);
        console.log(`📦 Export Completed:`);
        console.log(`- Total Records : ${docs.length}`);
        console.log(`- Export File   : ${outputPath}`);
        console.log(`- Contract Schema: ${schemaDest}`);
        console.log(`======================================================\n`);
      } finally {
        db.close();
      }
    });

  return cmd;
}
