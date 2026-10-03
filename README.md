# 💎 OmniGem Knowledge Platform — `gem-crawler`

> **CLI Batch Web Crawler & Snapshot Archiver**  
> Module thu thập dữ liệu web thô, bảo tồn snapshot nguyên vẹn, bóc tách văn bản sạch và đóng gói bàn giao `RawDocument` cho xưởng tinh chế tri thức `gem-data-processing`.

[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B%20LTS-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x%20Strict-blue.svg)](https://www.typescriptlang.org)
[![Crawlee](https://img.shields.io/badge/Crawlee-v3-orange.svg)](https://crawlee.dev)
[![Architecture](https://img.shields.io/badge/OmniGem-HLD%20Oct%202026-purple.svg)](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/High-Level%20Design.pdf)

---

## 📖 MỤC LỤC

1. [Tổng quan & Sứ mệnh](#1-tổng-quan--sứ-mệnh)
2. [5 Nguyên tắc Kiến trúc Bất biến](#2-5-nguyên-tắc-kiến-trúc-bất-biến)
3. [Kiến trúc Kỹ thuật Cốt lõi](#3-kiến-trúc-kỹ-thuật-cốt-lõi)
4. [Cài đặt & Chuẩn bị Môi trường](#4-cài-đặt--chuẩn-bị-môi-trường)
5. [Cấu hình Danh bạ Nguồn & Danh mục Đá](#5-cấu-hình-danh-bạ-nguồn--danh-mục-đá)
6. [Hướng dẫn Sử dụng Chi tiết Bộ Lệnh CLI](#6-hướng-dẫn-sử-dụng-chi-tiết-bộ-lệnh-cli)
   - [6.1. `crawl` — Khởi chạy thu thập batch](#61-crawl--khởi-chạy-thu-thập-batch)
   - [6.2. `sources` — Quản lý danh mục nguồn & test URL](#62-sources--quản-lý-danh-mục-nguồn--test-url)
   - [6.3. `inspect` — Tra cứu & Xem trực tiếp dữ liệu](#63-inspect--tra-cứu--xem-trực-tiếp-dữ-liệu)
   - [6.4. `verify` — Kiểm toán toàn vẹn & Schema Contract](#64-verify--kiểm-toán-toàn-vẹn--schema-contract)
   - [6.5. `export` — Đóng gói bàn giao cho Stage 2](#65-export--đóng-gói-bàn-giao-cho-stage-2)
7. [Hợp đồng Dữ liệu `RawDocument` v1.0.0](#7-hợp-đồng-dữ-liệu-rawdocument-v100)
8. [Cấu trúc Lưu trữ Dữ liệu (Hybrid Storage)](#8-cấu-trúc-lưu-trữ-dữ-liệu-hybrid-storage)
9. [Xử lý Sự cố & Câu hỏi Thường gặp (FAQ)](#9-xử-lý-sự-cố--câu-hỏi-thường-gặp-faq)

---

## 1. TỔNG QUAN & SỨ MỆNH

Trong nền tảng **OmniGem Knowledge Platform**, tri thức về đá quý, khoáng vật học và phong thủy di chuyển theo một luồng đơn hướng độc lập:

```
┌─────────────────┐       RawDocument       ┌──────────────────────┐      StoneProfile      ┌─────────────────┐
│   gem-crawler   │ ──────────────────────> │ gem-data-processing  │ ─────────────────────> │     gem-kb      │
│  (CLI / Batch)  │   (Snapshot + Hash +    │ (LLM Fact Extraction │   (Verified Profiles   │  (MCP Server +  │
│                 │      Cleaned Text)      │   & Cross-checking)  │       & Release)       │    HTTP API)    │
└─────────────────┘                         └──────────────────────┘                        └─────────────────┘
```

**Sứ mệnh của `gem-crawler`:**  
Thu thập dữ liệu web từ các nguồn tin cậy đã phân tầng, bảo tồn nguyên vẹn bản snapshot HTML gốc (.html.gz), loại bỏ cấu trúc rác (boilerplate removal), tính toán mã băm nội dung SHA-256 để phát hiện thay đổi, và đóng gói thành bản ghi `RawDocument` chuẩn mực cho bước xử lý tiếp theo.

---

## 2. 5 NGUYÊN TẮC KIẾN TRÚC BẤT BIẾN

Theo quy định tại Trang 2 của tài liệu kiến trúc [[High-Level Design.pdf](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/High-Level%20Design.pdf)]:

1. **Dữ liệu chảy một chiều:** `gem-crawler` $\rightarrow$ `gem-data-processing` $\rightarrow$ `gem-kb`. Crawler không import, không gọi và không phụ thuộc vào downstream.
2. **Chỉ chạy Batch CLI trên máy Local:** Không phải web server, không chạy daemon nền 24/7. Chạy theo yêu cầu của kỹ sư trên terminal.
3. **Tuyệt đối KHÔNG chạy LLM:** Crawler không hiểu ngữ nghĩa, không phân tích, không gọi API OpenAI/Anthropic/Gemini. Nhiệm vụ duy nhất là ELT tất định: Fetch $\rightarrow$ Clean rác $\rightarrow$ Hash SHA-256 $\rightarrow$ Lưu snapshot.
4. **Bảo tồn dữ liệu thô vĩnh viễn:** Snapshot HTML nguyên bản được nén Gzip (`.html.gz`) và lưu trữ dài hạn trên đĩa. Khi sửa logic tinh chế, chỉ chạy lại `gem-data-processing` mà không cần re-crawl.
5. **Thu thập có đạo đức & Tuân thủ pháp lý:**
   - Luôn tôn trọng file `robots.txt`.
   - Giới hạn tốc độ theo domain (`rate_limit_delay_ms`, tối thiểu 1.5s).
   - Kiểm tra hạn TTL: bỏ qua trang đã lấy nếu còn hạn (trừ khi dùng `--force`).
   - **Nghiêm cấm crawl:** Sàn TMĐT (Shopee, Lazada, TikTok Shop) và Facebook Group.

---

## 3. KIẾN TRÚC KỸ THUẬT CỐT LÕI

Hệ thống được thiết kế theo các module chức năng độc lập:

- **Dual-Engine Dispatcher ([`src/core/dispatcher.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/core/dispatcher.ts)):**
  - **`CheerioCrawler`:** Tải nhanh qua HTTP request thuần (`got-scraping`), parse DOM bằng Cheerio. Tối ưu cực đại cho nguồn Tầng 1 Wikipedia và các blog Tầng 2 tĩnh (RAM chỉ ~40MB, 50-200ms/trang).
  - **`PlaywrightCrawler`:** Dành cho trang web động phức tạp (Mindat.org, GIA) cần evaluate JavaScript và vượt anti-bot challenge. Tự động chặn tải images/fonts/media để tiết kiệm băng thông.
- **Pipeline Làm sạch Văn bản ([`src/extractors/cleaner.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/extractors/cleaner.ts)):**
  - Kết hợp **Domain Specific Selectors** (Cheerio) cho Wikipedia/Mindat và **`@mozilla/readability`** kết hợp **`linkedom`** cho blog tự do. Loại bỏ triệt để header, footer, quảng cáo, widget.
- **Bảo toàn Cấu trúc Bảng với Markdown ([`src/extractors/markdown.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/extractors/markdown.ts)):**
  - Sử dụng `turndown` với plugin `turndown-plugin-gfm` chuyển HTML bài viết thành Markdown giữ nguyên các bảng thông số kỹ thuật (độ cứng Mohs, tỷ trọng, hệ tinh thể), giảm 70% token khi chuyển sang LLM ở Stage 2.
- **Normalized SHA-256 Hasher ([`src/extractors/hasher.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/extractors/hasher.ts)):**
  - Chuẩn hóa Unicode tiếng Việt (NFC), cắt tỉa khoảng trắng và loại bỏ dòng trống trước khi băm để phát hiện chính xác bài viết có bị sửa đổi nội dung hay không.
- **Hybrid Storage Layer ([`src/storage/db.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/storage/db.ts) & [`src/storage/snapshot-store.ts`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/src/storage/snapshot-store.ts)):**
  - SQLite Write-Ahead Logging (WAL mode) lưu trữ metadata, cache và index tìm kiếm.
  - File System lưu trữ snapshot nén `.html.gz`.

---

## 4. CÀI ĐẶT & CHUẨN BỊ MÔI TRƯỜNG

### Yêu cầu hệ thống
- **Node.js:** v20.0.0 LTS trở lên (khuyên dùng Node 20/22).
- **Trình quản lý gói:** `npm` (hoặc `pnpm`).

### Các bước cài đặt
```bash
# 1. Di chuyển vào thư mục dự án
cd /Users/leonard/Workspace/projects/omni-gems/gem-crawler

# 2. Cài đặt các gói phụ thuộc
npm install

# 3. Cài đặt trình duyệt Chromium cho Playwright (nếu chưa có)
npx playwright install chromium

# 4. Biên dịch mã nguồn TypeScript
npm run build
```

---

## 5. CẤU HÌNH DANH BẠ NGUỒN & DANH MỤC ĐÁ

### 5.1. Danh bạ nguồn phân theo 3 tầng tin cậy ([`config/sources.json`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/config/sources.json))
- **Tầng 1 (Khoa học):** Wikipedia (`vi.wikipedia.org`, `en.wikipedia.org`), Mindat (`mindat.org`), GIA (`gia.edu`). TTL = 60–90 ngày.
- **Tầng 2 (Phong thủy Tiếng Việt):** Các blog chuyên sâu về đá quý phong thủy uy tín tại Việt Nam (An Phát, Blog Đá Quý VN). TTL = 30 ngày.
- **Tầng 3 (Hỏi đáp Cộng đồng):** Diễn đàn và trang hỏi đáp (Webtretho). TTL = 14 ngày.

*Ví dụ cấu hình một nguồn:*
```json
{
  "id": "wiki-vi",
  "name": "Wikipedia Tiếng Việt",
  "domain": "vi.wikipedia.org",
  "tier": 1,
  "category": "scientific",
  "engine": "cheerio",
  "rate_limit_delay_ms": 2000,
  "ttl_days": 60,
  "selectors": {
    "article": "#mw-content-text .mw-parser-output",
    "remove": [".navbox", "#toc", ".reference", ".reflist"]
  }
}
```

### 5.2. Danh mục đá mục tiêu ([`config/seed-stones.json`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/config/seed-stones.json))
Quản lý mã slug, tên chính, tên gọi khác (`aliases` - phục vụ chuẩn hóa ở Stage 2), từ khóa tìm kiếm và cờ tồn kho tại cửa hàng (`in_stock`):
```json
{
  "slug": "thach-anh-hong",
  "primary_name": "Thạch anh hồng",
  "aliases": ["Rose Quartz", "Đá hồng", "Thạch anh phấn"],
  "in_stock": true,
  "priority": 1,
  "search_keywords": ["thạch anh hồng", "rose quartz", "thạch anh hồng hợp mệnh gì"]
}
```

---

## 6. HƯỚNG DẪN SỬ DỤNG CHI TIẾT BỘ LỆNH CLI

Sau khi build (`npm run build`), công cụ được thực thi thông qua `node dist/index.js <command> [options]`.

```
Cú pháp tổng quát:
  gem-crawler <command> [options]

Các lệnh chính:
  crawl       Khởi chạy phiên batch crawl thu thập dữ liệu web
  sources     Quản lý, kiểm tra danh mục nguồn và test trích xuất URL
  inspect     Xem nhanh nội dung text, markdown, json hoặc snapshot
  verify      Kiểm toán dữ liệu, hash, snapshot và JSON Schema
  export      Đóng gói dữ liệu RawDocument bàn giao cho gem-data-processing
```

---

### 6.1. `crawl` — Khởi chạy thu thập batch

```bash
# 1. Chạy giả lập (Dry run) xem danh sách URL sẽ crawl mà không gửi request mạng:
node dist/index.js crawl --stone thach-anh-hong --dry-run

# 2. Crawl một loại đá cụ thể cho cả 3 tầng nguồn:
node dist/index.js crawl --stone thach-anh-hong

# 3. Crawl chỉ các loại đá cửa hàng ĐANG CÓ HÀNG (Ưu tiên P0 theo HLD p.6):
node dist/index.js crawl --in-stock-only --tier 1,2

# 4. Ép buộc crawl lại (bỏ qua Cache TTL và ETag):
node dist/index.js crawl --stone ngoc-bich --force

# 5. Tùy chỉnh độ trễ domain và số luồng song song:
node dist/index.js crawl --concurrency 3 --delay 2.0 --engine cheerio
```

**Bảng tham số của lệnh `crawl`:**
| Tham số | Viết tắt | Ý nghĩa | Mặc định |
| :--- | :--- | :--- | :--- |
| `--stone <slug>` | `-s` | Chỉ định slug của đá cần crawl | Toàn bộ seed stones |
| `--tier <numbers>` | `-t` | Lọc theo tầng nguồn (ví dụ: `1` hoặc `1,2`) | Cả 3 tầng |
| `--in-stock-only` | | Chỉ crawl các loại đá có `in_stock: true` | `false` |
| `--force` | `-f` | Bỏ qua kiểm tra TTL/ETag, bắt buộc tải lại | `false` |
| `--concurrency <num>`| `-c` | Số lượng request chạy song song | `5` |
| `--delay <sec>` | `-d` | Thời gian nghỉ giữa các request cùng domain | `1.5s` |
| `--engine <type>` | | Ép kiểu engine (`cheerio`, `playwright`, `auto`)| `auto` |
| `--dry-run` | | Chỉ in kế hoạch URL, không gửi HTTP request | `false` |

---

### 6.2. `sources` — Quản lý danh mục nguồn & Test URL

```bash
# Liệt kê tất cả nguồn đã đăng ký kèm tầng nguồn và engine:
node dist/index.js sources list

# Kiểm tra thuật toán bóc tách trên một URL thực tế:
node dist/index.js sources test-url https://vi.wikipedia.org/wiki/Th%E1%BA%A1ch_anh_h%E1%BB%93ng
```

---

### 6.3. `inspect` — Tra cứu & Xem trực tiếp dữ liệu

Lệnh giúp bạn xem nhanh tài liệu đã lưu mà không cần mở DB hay giải nén thủ công:

```bash
# 1. Xem nội dung văn bản thuần (Plain text):
node dist/index.js inspect --stone thach-anh-hong

# 2. Xem định dạng Markdown (bảo toàn bảng thông số Mohs):
node dist/index.js inspect --stone thach-anh-hong --format markdown

# 3. Xem bản ghi JSON đầy đủ (kèm metadata, headers, hash):
node dist/index.js inspect --stone thach-anh-hong --format json

# 4. Xem mã HTML gốc được giải nén trực tiếp từ snapshot .html.gz:
node dist/index.js inspect --stone thach-anh-hong --format html

# 5. Tra cứu theo Document ID cụ thể:
node dist/index.js inspect --id "67d26180-cb8f-410a-b534-94fc02a4771e"
```

---

### 6.4. `verify` — Kiểm toán toàn vẹn & Schema Contract

Lệnh quét toàn bộ cơ sở dữ liệu và file system để kiểm toán chất lượng trước khi bàn giao:
- Kiểm tra tính hợp lệ của từng bản ghi theo [schemas/raw-document.schema.json](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/schemas/raw-document.schema.json) (dùng AJV 2020).
- Kiểm tra sự tồn tại của file snapshot `.html.gz` trên đĩa.
- Tính toán lại SHA-256 trên văn bản sạch để phát hiện lỗi hỏng dữ liệu (bit rot).

```bash
node dist/index.js verify
```
*Kết quả mẫu:*
```
======================================================
📊 Audit Summary:
- Total Documents : 2
- 100% Valid      : 2
- Schema Errors   : 0
- Missing Snapshot: 0
- Hash Mismatches : 0
======================================================
```

---

### 6.5. `export` — Đóng gói bàn giao cho Stage 2

Đóng gói các bản ghi thành định dạng Newline Delimited JSON (`.ndjson`) và tự động sao chép JSON Schema đi kèm:

```bash
# Xuất dữ liệu của phiên chạy gần nhất:
node dist/index.js export --run-id latest

# Xuất dữ liệu của loại đá cụ thể vào đường dẫn tùy chọn:
node dist/index.js export --stone thach-anh-hong --output ./exports/thach_anh_hong.ndjson
```

---

## 7. HỢP ĐỒNG DỮ LIỆU `RAWDOCUMENT` V1.0.0

Hợp đồng dữ liệu chính thức giữa `gem-crawler` và `gem-data-processing` được định nghĩa bằng JSON Schema Draft 2020-12 tại [`schemas/raw-document.schema.json`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/schemas/raw-document.schema.json).

```typescript
export interface RawDocumentV1 {
  schema_version: '1.0.0';
  id: string; // UUID v4
  run_id: string; // UUID v4 phiên crawl
  target_stone: string; // Slug định danh, vd: "thach-anh-hong"
  source_tier: 1 | 2 | 3; // 1: Khoa học | 2: Phong thủy VN | 3: Hỏi đáp
  original_url: string; // URL ban đầu đưa vào hàng đợi
  canonical_url: string; // URL đích sau redirect / canonical tag
  crawl_timestamp: string; // Chuẩn ISO 8601 UTC
  http_status: number; // 200, 304...
  response_headers?: Record<string, string | undefined>;
  page_title: string; // Tiêu đề trang
  content_hash: string; // SHA-256 (64 hex characters)
  raw_html_path: string; // Đường dẫn tương đối trỏ tới file .html.gz
  raw_html_size_bytes?: number;
  compressed_size_bytes?: number;
  cleaned_text: string; // Text thuần đã bóc tách rác
  cleaned_markdown?: string; // Markdown có cấu trúc giữ bảng dữ liệu
  extractor_metadata: {
    engine: 'cheerio' | 'playwright';
    strategy: 'readability-linkedom' | 'domain-selector' | 'fallback';
    word_count: number;
    character_count?: number;
    language_detected?: string;
  };
}
```

---

## 8. CẤU TRÚC LƯU TRỮ DỮ LIỆU (HYBRID STORAGE)

```
gem-crawler/
├── data/
│   ├── crawler.db               # SQLite database file (WAL mode kích hoạt)
│   ├── crawler.db-wal           # SQLite Write-Ahead Log
│   └── snapshots/               # Snapshot HTML thô nén (không commit git)
│       ├── tier-1/
│       │   └── thach-anh-hong/
│       │       └── 20261003_b915d0c9b2c0.html.gz
│       ├── tier-2/
│       └── tier-3/
├── exports/                     # Dữ liệu xuất giao cho gem-data-processing
│   ├── raw_export_20261003_1ccce8ec.ndjson
│   └── schemas/
│       └── raw-document.schema.json
├── config/                      # Cấu hình nguồn và danh mục đá
│   ├── sources.json
│   └── seed-stones.json
├── schemas/                     # JSON Schema hợp đồng
│   └── raw-document.schema.json
└── docs/                        # Tài liệu đặc tả kỹ thuật chi tiết
    └── CRAWLER_TOOLS_SPECIFICATION.md
```

---

## 9. XỬ LÝ SỰ CỐ & CÂU HỎI THƯỜNG GẶP (FAQ)

### Q1: Tại sao chạy `crawl` lại báo "Skipped X URLs because their TTL is still fresh"?
- **Nguyên nhân:** Theo nguyên tắc HLD, crawler không tải lại những trang đã lấy nếu chưa hết hạn TTL (T1: 60 ngày, T2: 30 ngày, T3: 14 ngày) để tránh làm phiền máy chủ đối tác.
- **Cách xử lý:** Nếu bạn muốn ép buộc crawl lại dữ liệu mới nhất, hãy thêm cờ `--force`.

### Q2: Khi gặp lỗi `403 Forbidden` trên một số trang web thì xử lý thế nào?
- Hệ thống đã tích hợp cơ chế xoay vòng User-Agent trình duyệt thực tế. Đối với các trang sử dụng Cloudflare bảo vệ hoặc yêu cầu JavaScript động (như Mindat), hãy chỉ định `--engine playwright` để khởi chạy trình duyệt Chromium thật thay vì HTTP client thuần.

### Q3: Muốn thêm một loại đá mới vào danh sách crawl thì làm thế nào?
- Mở file [`config/seed-stones.json`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/config/seed-stones.json), thêm 1 block JSON chứa `slug`, `primary_name`, `aliases`, `in_stock: true|false`, và danh sách `search_keywords`. Hệ thống sẽ tự động nhận diện ở lần chạy kế tiếp.

### Q4: Muốn xóa dữ liệu crawl để làm lại từ đầu?
- Bạn có thể xóa file `data/crawler.db` và thư mục `data/snapshots/`. Hệ thống sẽ tự động khởi tạo lại database trắng và cấu trúc bảng WAL mode ở lần chạy tiếp theo.

---

## 📚 TÀI LIỆU LIÊN QUAN
- [Tài liệu Kiến trúc Cấp cao OmniGem](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/High-Level%20Design.pdf)
- [Đặc tả Kỹ thuật Chi tiết Crawler Tools](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/docs/CRAWLER_TOOLS_SPECIFICATION.md)
- [Hợp đồng Dữ liệu RawDocument Schema](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/schemas/raw-document.schema.json)
