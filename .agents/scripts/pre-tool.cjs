#!/usr/bin/env node
/**
 * Antigravity PreToolUse Permission Engine & Audit Logger
 * Scope: Project-level (gem-crawler)
 * 
 * Quản lý chính sách thực thi lệnh:
 * - DENY: Chặn đứng lệnh nguy hiểm và chặn push trực tiếp lên main/develop.
 * - ALLOW: Tự động cấp quyền (Auto-approve) cho lệnh build, crawl, git branch/commit/pr và push nhánh phụ.
 * - ASK: Buộc dừng lại hỏi người dùng xác nhận cho merge PR hoặc các lệnh nhạy cảm.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// =============================================================================
// HELPER: LẤY TÊN GIT BRANCH HIỆN TẠI
// =============================================================================
function getCurrentGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();
  } catch (e) {
    return '';
  }
}

// =============================================================================
// 1. CẤU HÌNH BỘ QUY TẮC PHÂN QUYỀN (PERMISSION POLICY)
// =============================================================================

// Danh sách các mẫu lệnh BỊ CẤM TUYỆT ĐỐI (Hard Block)
const DENY_PATTERNS = [
  // Chặn xóa dữ liệu gốc (data/) hoặc toàn bộ hệ thống
  { pattern: /rm\s+-rf\s+(data|\/|\*|data\/.*)/i, reason: 'Nghiêm cấm xóa dữ liệu gốc (data/) hoặc hệ thống!' },
  { pattern: /DROP\s+TABLE/i, reason: 'Nghiêm cấm xóa bảng trong SQLite!' },
  { pattern: /curl.*\|\s*(bash|sh)/i, reason: 'Nghiêm cấm thực thi script từ xa qua curl | bash!' },

  // Chặn force push và destructive git commands
  { pattern: /^git\s+push\s+.*(--force|-f\b)/i, reason: 'Nghiêm cấm git push --force!' },
  { pattern: /^git\s+reset\s+--hard/i, reason: 'Nghiêm cấm git reset --hard làm mất code chưa commit!' },
  { pattern: /^git\s+clean\s+-fdx/i, reason: 'Nghiêm cấm git clean -fdx làm mất các file chưa track!' },
];

// Danh sách các mẫu lệnh ĐƯỢC PHÉP CHẠY TỰ ĐỘNG (Auto-Approved / Turbo)
const ALLOW_PATTERNS = [
  // Build & kiểm tra code
  { pattern: /^npm\s+run\s+(build|lint|format|verify)/i, reason: 'Lệnh build/lint/verify nội bộ dự án' },
  { pattern: /^npx\s+tsc(\s+.*)?$/i, reason: 'Lệnh TypeScript compiler kiểm tra kiểu' },
  
  // Crawler execution & CLI
  { pattern: /^node\s+dist\/index\.js\s+(crawl|verify|sources|inspect|export)(\s+.*)?$/i, reason: 'Lệnh CLI crawler chính thức của dự án' },
  { pattern: /^npx\s+tsx\s+src\/index\.ts(\s+.*)?$/i, reason: 'Lệnh dev crawler qua tsx' },
  { pattern: /^gem-crawler\s+.*$/i, reason: 'Lệnh binary gem-crawler' },

  // Git an toàn: quan sát & đọc thông tin
  { pattern: /^git\s+(status|diff|log|branch|show)(\s+.*)?$/i, reason: 'Lệnh Git chỉ đọc thông tin' },
  
  // Git workflow: pull, checkout, switch, add, commit
  { pattern: /^git\s+pull(\s+.*)?$/i, reason: 'Cập nhật code mới nhất từ remote (git pull)' },
  { pattern: /^git\s+(checkout|switch)(\s+.*)?$/i, reason: 'Chuyển hoặc tạo branch (git checkout/switch)' },
  { pattern: /^git\s+add(\s+.*)?$/i, reason: 'Thêm file vào staging area (git add)' },
  { pattern: /^git\s+commit(\s+.*)?$/i, reason: 'Tạo commit với thông điệp (git commit)' },

  // GitHub PR: tạo PR và xem trạng thái PR
  { pattern: /^(gh|git)\s+pr\s+(create|view|list|status|checks)(\s+.*)?$/i, reason: 'Tạo hoặc xem Pull Request' },

  // Lệnh shell đọc thông tin cơ bản
  { pattern: /^(ls|find|cat|head|tail|wc|echo|pwd)(\s+.*)?$/i, reason: 'Lệnh shell đọc thông tin cơ bản' },
];

// Danh sách các mẫu lệnh PHẢI HỎI XÁC NHẬN TỪ NGƯỜI DÙNG (Require User Approval)
const ASK_PATTERNS = [
  // Dependency changes
  { pattern: /^npm\s+(install|i|add|uninstall|remove)(\s+.*)?$/i, reason: 'Cài đặt / gỡ bỏ thư viện dependency cần xác nhận' },

  // Merge PR (Tác động chốt code vào branch chính)
  { pattern: /^(gh|git)\s+pr\s+merge(\s+.*)?$/i, reason: 'Hành động Merge Pull Request cần xác nhận của người dùng' },
];

// =============================================================================
// 2. LOGIC ĐÁNH GIÁ VÀ XỬ LÝ QUYỀN
// =============================================================================

function evaluatePermission(toolName, commandLine) {
  if (toolName !== 'run_command') {
    return { decision: 'allow' };
  }

  const cleanCmd = commandLine.trim();

  // ---------------------------------------------------------------------------
  // XỬ LÝ ĐẶC THÙ CHO "git push" (BẢO VỆ MAIN / DEVELOP)
  // ---------------------------------------------------------------------------
  if (/^git\s+push/i.test(cleanCmd)) {
    // 1. Kiểm tra force push
    if (/--force|-f\b/i.test(cleanCmd)) {
      return {
        decision: 'deny',
        reason: '[DENY] Nghiêm cấm git push --force!'
      };
    }

    // 2. Kiểm tra nếu câu lệnh có đích danh main/master/develop/dev
    const targetMainRegex = /\b(origin\s+)?(main|master|develop|dev)\b/i;
    if (targetMainRegex.test(cleanCmd)) {
      return {
        decision: 'deny',
        reason: '[DENY] Nghiêm cấm push trực tiếp lên main/develop! Hãy push lên branch feature/fix và mở Pull Request.'
      };
    }

    // 3. Kiểm tra branch hiện tại trên máy (nếu lệnh chỉ là "git push" hoặc "git push origin")
    const currentBranch = getCurrentGitBranch();
    const protectedBranches = ['main', 'master', 'develop', 'dev'];
    if (protectedBranches.includes(currentBranch)) {
      return {
        decision: 'deny',
        reason: `[DENY] Bạn đang đứng ở branch '${currentBranch}'. Nghiêm cấm push từ branch này! Hãy checkout sang feature/* hoặc fix/*.`
      };
    }

    // 4. Cho phép tự động nếu push lên các nhánh tính năng quy chuẩn (feature, fix, chore, ...)
    const safeBranchPattern = /(feature|fix|chore|refactor|bugfix|hotfix|docs|test)\/.+/i;
    if (safeBranchPattern.test(cleanCmd) || safeBranchPattern.test(currentBranch)) {
      return {
        decision: 'allow',
        reason: `[AUTO-APPROVE] Cho phép git push lên branch '${currentBranch || 'feature/fix'}'.`
      };
    }

    // 5. Nếu tên nhánh không thuộc quy chuẩn: hỏi xác nhận người dùng
    return {
      decision: 'ask',
      reason: `[ASK] Xác nhận git push lên nhánh '${currentBranch || 'chưa rõ'}'.`
    };
  }

  // ---------------------------------------------------------------------------
  // ĐÁNH GIÁ THEO DANH SÁCH DENY > ASK > ALLOW
  // ---------------------------------------------------------------------------

  // 1. Kiểm tra danh sách DENY
  for (const rule of DENY_PATTERNS) {
    if (rule.pattern.test(cleanCmd)) {
      return {
        decision: 'deny',
        reason: `[DENY] ${rule.reason}`
      };
    }
  }

  // 2. Kiểm tra danh sách ASK
  for (const rule of ASK_PATTERNS) {
    if (rule.pattern.test(cleanCmd)) {
      return {
        decision: 'ask',
        reason: `[ASK] ${rule.reason}`
      };
    }
  }

  // 3. Kiểm tra danh sách ALLOW
  for (const rule of ALLOW_PATTERNS) {
    if (rule.pattern.test(cleanCmd)) {
      return {
        decision: 'allow',
        reason: `[AUTO-APPROVE] ${rule.reason}`
      };
    }
  }

  // 4. Mặc định với các lệnh chưa rõ: Hỏi người dùng
  return {
    decision: 'ask',
    reason: `Lệnh "${cleanCmd}" chưa nằm trong danh mục whitelist của dự án.`
  };
}

// =============================================================================
// 3. ENTRYPOINT & ĐỌC STDIN / GHI STDOUT
// =============================================================================

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

  // Ghi nhật ký kiểm toán (Audit Trail)
  const logDir = path.resolve(__dirname, '..', '..', 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, 'agent_audit.log'),
    `[${new Date().toISOString()}] [STEP ${payload.stepIdx || 0}] [TOOL: ${toolName}] CMD: ${commandLine}\n`
  );

  // Đánh giá quyền
  const result = evaluatePermission(toolName, commandLine);

  // Trả về JSON trên stdout theo hợp đồng của Antigravity Hook
  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({ decision: 'ask', reason: `Hook execution error: ${err.message}` }));
});
