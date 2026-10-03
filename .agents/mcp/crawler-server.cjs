#!/usr/bin/env node
/**
 * Lightweight Zero-dependency Model Context Protocol (MCP) Server
 * Exposes gem-crawler tools to Antigravity via Stdio JSON-RPC 2.0
 */

const readline = require('readline');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..', '..');

const TOOLS = [
  {
    name: 'crawl_stone',
    description: 'Kích hoạt phiên crawl thu thập dữ liệu cho một loại đá quý cụ thể theo tầng nguồn.',
    inputSchema: {
      type: 'object',
      properties: {
        stone: {
          type: 'string',
          description: 'Mã slug của loại đá (vd: thach-anh-hong, ruby, sapphire, ngoc-bich)'
        },
        tier: {
          type: 'string',
          description: 'Lọc theo tầng nguồn, ví dụ "1" hoặc "1,2"'
        },
        inStockOnly: {
          type: 'boolean',
          description: 'Chỉ crawl các loại đá đang có hàng sẵn tại cửa hàng'
        },
        dryRun: {
          type: 'boolean',
          description: 'Chỉ in danh sách URL cần crawl mà không tải dữ liệu'
        }
      },
      required: ['stone']
    }
  },
  {
    name: 'verify_crawler_data',
    description: 'Kiểm toán toàn vẹn dữ liệu SQLite, snapshot gzip và đối soát JSON Schema RawDocumentV1.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_crawler_stats',
    description: 'Truy vấn thống kê thời gian thực từ SQLite data/crawler.db (tổng tài liệu, trạng thái run gần nhất).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_crawler_dataset',
    description: 'Xuất dữ liệu RawDocument dạng NDJSON/JSON để bàn giao cho gem-data-processing.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'UUID của run_id cụ thể hoặc "latest"'
        },
        stone: {
          type: 'string',
          description: 'Lọc theo slug đá'
        },
        output: {
          type: 'string',
          description: 'Đường dẫn file đích (vd: ./exports/run_latest.ndjson)'
        }
      },
      required: ['output']
    }
  }
];

function handleToolCall(name, args) {
  try {
    switch (name) {
      case 'crawl_stone': {
        const flags = [`--stone ${args.stone}`];
        if (args.tier) flags.push(`--tier ${args.tier}`);
        if (args.inStockOnly) flags.push('--in-stock-only');
        if (args.dryRun) flags.push('--dry-run');

        const cmd = `node dist/index.js crawl ${flags.join(' ')}`;
        const output = execSync(cmd, { cwd: rootDir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return { content: [{ type: 'text', text: output || 'Crawl command completed successfully.' }] };
      }

      case 'verify_crawler_data': {
        const cmd = 'node dist/index.js verify';
        const output = execSync(cmd, { cwd: rootDir, encoding: 'utf8' });
        return { content: [{ type: 'text', text: output || 'Verification passed.' }] };
      }

      case 'get_crawler_stats': {
        const dbPath = path.join(rootDir, 'data', 'crawler.db');
        if (!fs.existsSync(dbPath)) {
          return { content: [{ type: 'text', text: 'Chưa có database data/crawler.db.' }] };
        }
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        const docCount = db.prepare('SELECT COUNT(*) as count FROM raw_documents').get().count;
        const runs = db.prepare('SELECT id, status, started_at, total_processed, total_new FROM crawl_runs ORDER BY started_at DESC LIMIT 5').all();
        db.close();

        const summary = {
          total_documents: docCount,
          recent_runs: runs
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      }

      case 'export_crawler_dataset': {
        const flags = [`--output ${args.output}`];
        if (args.runId) flags.push(`--run-id ${args.runId}`);
        if (args.stone) flags.push(`--stone ${args.stone}`);

        const cmd = `node dist/index.js export ${flags.join(' ')}`;
        const output = execSync(cmd, { cwd: rootDir, encoding: 'utf8' });
        return { content: [{ type: 'text', text: output || `Exported to ${args.output}` }] };
      }

      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Execution failed: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}` }]
    };
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    const { id, method, params } = request;

    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'gem-crawler-mcp', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (method === 'notifications/initialized') {
      // No response needed for notification
    } else if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (method === 'tools/call') {
      const toolName = params ? params.name : '';
      const toolArgs = params ? params.arguments || {} : {};
      const result = handleToolCall(toolName, toolArgs);
      const response = {
        jsonrpc: '2.0',
        id,
        result
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (id !== undefined) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      }) + '\n');
    }
  } catch (err) {
    // Malformed JSON
  }
});
