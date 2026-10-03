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
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};
  const commandLine = args.CommandLine || '';

  // 1. Ghi log kiểm toán (Audit Trail)
  const logDir = path.resolve(__dirname, '..', '..', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const auditLogPath = path.join(logDir, 'agent_audit.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(
    auditLogPath,
    `[${timestamp}] [STEP ${payload.stepIdx || 0}] [TOOL: ${toolName}] ${commandLine ? 'CMD: ' + commandLine : JSON.stringify(args)}\n`
  );

  // 2. Chặn các lệnh nguy hiểm với thư mục dữ liệu
  if (toolName === 'run_command') {
    if (commandLine.includes('rm -rf data') || commandLine.includes('rm -rf data/crawler.db')) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: 'Harness Security Gate: Hành động xóa toàn bộ database hoặc snapshot trong data/ bị nghiêm cấm!'
      }));
      return;
    }

    // 3. Tự động cấp quyền (Auto-approval) cho các lệnh long-running an toàn
    const isSafeCrawlerCommand =
      commandLine.startsWith('node dist/index.js') ||
      commandLine.startsWith('npm run') ||
      commandLine.startsWith('npx tsx') ||
      commandLine.startsWith('gem-crawler');

    if (isSafeCrawlerCommand) {
      console.log(JSON.stringify({
        decision: 'allow',
        reason: 'Harness Policy: Tự động phê duyệt lệnh chạy crawler/build/verify.'
      }));
      return;
    }
  }

  // Mặc định cho phép
  console.log(JSON.stringify({ decision: 'allow' }));
}

main().catch(err => {
  console.error(err);
  console.log(JSON.stringify({ decision: 'allow' }));
});
