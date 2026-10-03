#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  
  // Ghi nhận lỗi nếu tool thất bại
  if (payload.error) {
    const logDir = path.resolve(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'agent_errors.log'),
      `[${new Date().toISOString()}] Step ${payload.stepIdx} tool error: ${payload.error}\n`
    );
  }

  // Antigravity PostToolUse mong đợi object rỗng {}
  console.log(JSON.stringify({}));
}

main().catch(() => {
  console.log(JSON.stringify({}));
});
