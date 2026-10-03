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
  const payload = await readStdin();

  // 1. Kiểm tra background tasks từ runtime
  if (payload.fullyIdle === false) {
    console.log(JSON.stringify({
      decision: 'continue',
      reason: 'Harness Quality Gate: Các tác vụ nền (Background Tasks / Crawler) vẫn đang thực thi. Vui lòng chờ hoàn tất trước khi kết thúc phiên.'
    }));
    return;
  }

  // 2. Kiểm tra trạng thái trong SQLite
  const dbPath = path.resolve(__dirname, '..', '..', 'data', 'crawler.db');
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const runningJob = db.prepare("SELECT id, started_at FROM crawl_runs WHERE status = 'RUNNING' LIMIT 1").get();
      db.close();

      if (runningJob) {
        console.log(JSON.stringify({
          decision: 'continue',
          reason: `Harness Quality Gate: Phiên crawl (${runningJob.id.slice(0, 8)}) bắt đầu lúc ${runningJob.started_at} vẫn đang ở trạng thái RUNNING trong SQLite. Hãy kiểm tra logs hoặc đợi hoàn tất.`
        }));
        return;
      }
    } catch (e) {
      // Bỏ qua nếu DB bận
    }
  }

  // Cho phép kết thúc bình thường
  console.log(JSON.stringify({
    decision: 'stop'
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ decision: 'stop' }));
});
