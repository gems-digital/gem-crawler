#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

async function main() {
  await readStdin();
  
  const dbPath = path.resolve(__dirname, '..', '..', 'data', 'crawler.db');
  let statusSummary = '';

  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const docCount = db.prepare('SELECT COUNT(*) as cnt FROM raw_documents').get().cnt;
      const lastRun = db.prepare('SELECT id, status, started_at, total_processed, total_new FROM crawl_runs ORDER BY started_at DESC LIMIT 1').get();
      
      statusSummary = `[Harness Telemetry] SQLite State: ${docCount} raw documents saved. `;
      if (lastRun) {
        statusSummary += `Last run (${lastRun.id.slice(0, 8)}) status: ${lastRun.status} (${lastRun.total_processed} processed, ${lastRun.total_new} new).`;
      }
      db.close();
    } catch (e) {
      statusSummary = `[Harness Telemetry] Database exists but currently locked/unreadable: ${e.message}`;
    }
  } else {
    statusSummary = '[Harness Telemetry] data/crawler.db chưa được tạo. Hãy chạy crawl hoặc verify để khởi tạo.';
  }

  console.log(JSON.stringify({
    injectSteps: [
      {
        ephemeralMessage: statusSummary
      }
    ]
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ injectSteps: [] }));
});
