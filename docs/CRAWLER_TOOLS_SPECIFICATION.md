# TÀI LIỆU ĐẶC TẢ KỸ THUẬT VÀ KIẾN TRÚC CHI TIẾT
# CRAWLER TOOLS MODULE (`gem-crawler`)
## OmniGem Knowledge Platform

- **Phiên bản tài liệu:** 1.0.0
- **Ngày phát hành:** 02/10/2026
- **Tài liệu gốc tham chiếu:** `High-Level Design.pdf` (Oct 1, 2026 - @Leonard)
- **Tác giả:** OmniGem Architecture Team & Research Subagents

---

## MỤC LỤC

1. [Tổng quan & Nguyên tắc Thiết kế Bất biến](#1-tổng-quan--nguyên-tắc-thiết-kế-bất-biến)
2. [Ranh giới Module & Phạm vi Chức năng (Scope & Anti-Scope)](#2-ranh-giới-module--phạm-vi-chức-năng-scope--anti-scope)
3. [Kiến trúc Crawler Core & Crawlee Engine](#3-kiến-trúc-crawler-core--crawlee-engine)
   - 3.1. Phân bổ Engine linh hoạt (Dual-Engine: CheerioCrawler vs PlaywrightCrawler)
   - 3.2. Quản lý Hàng đợi & Session (RequestQueue & SessionPool)
   - 3.3. Tôn trọng Robots.txt & Giới hạn Tốc độ Domain-level Throttling
   - 3.4. Quản lý Tuổi thọ Dữ liệu & Freshness Cache TTL
4. [Pipeline Tiền xử lý & Snapshot Storage Engine](#4-pipeline-tiền-xử-lý--snapshot-storage-engine)
   - 4.1. Bóc tách Văn bản Sạch (Readability + Linkedom + Selectors)
   - 4.2. Chuyển đổi Cleaned Markdown bảo toàn Bảng dữ liệu
   - 4.3. Thuật toán Content Hashing (Normalized SHA-256)
   - 4.4. Cơ chế Nén và Lưu trữ Snapshot nguyên vẹn
5. [Đặc tả Hợp đồng Dữ liệu RawDocument v1.0.0 (Data Contract)](#5-đặc-tả-hợp-đồng-dữ-liệu-rawdocument-v100-data-contract)
   - 5.1. Định dạng JSON Schema Draft 2020-12
   - 5.2. TypeScript Interface chuẩn
   - 5.3. Quy trình Kiểm định Hợp đồng (Contract Validation)
6. [Thiết kế Source Registry & Phân tầng Tin cậy](#6-thiết-kế-source-registry--phân-tầng-tin-cậy)
   - 6.1. Cấu trúc Nguồn Tầng 1, 2, 3
   - 6.2. Danh mục Đá Mục tiêu (Seed Stones) & Ưu tiên Hàng có sẵn
7. [Kiến trúc Lưu trữ Cục bộ (Hybrid Storage: SQLite + Filesystem)](#7-kiến-trúc-lưu-trữ-cục-bộ-hybrid-storage-sqlite--filesystem)
   - 7.1. Database Schema DDL (WAL Mode)
   - 7.2. Cấu trúc Thư mục Dữ liệu
8. [Bộ Công cụ Dòng lệnh (CLI Tools Suite)](#8-bộ-công-cụ-dòng-lệnh-cli-tools-suite)
   - 8.1. Thiết kế Hệ thống Lệnh (`crawl`, `sources`, `verify`, `inspect`, `export`)
   - 8.2. Danh mục Tham số & Quy trình Thực thi
9. [Chiến lược Xử lý Lỗi, Phục hồi & Phòng chống Chặn (Anti-Blocking)](#9-chiến-lược-xử-lý-lỗi-phục-hồi--phòng-chống-chặn-anti-blocking)
10. [Hệ thống Dẫn chứng & Trích dẫn (Citations & References)](#10-hệ-thống-dẫn-chứng--trích-dẫn-citations--references)

---

## 1. TỔNG QUAN & NGUYÊN TẮC THIẾT KẾ BẤT BIẾN

Hệ thống OmniGem Knowledge Platform xử lý tri thức chuyên sâu về đá quý, khoáng vật học và phong thủy qua luồng một chiều gồm 3 module độc lập `[HLD p.1]`:
1. `gem-crawler`: Thu thập dữ liệu web thô, bảo tồn nguyên vẹn snapshot và trích xuất text sạch.
2. `gem-data-processing`: Xưởng tinh chế chuyển hóa dữ liệu thô và kiến thức gia đình thành các Fact đã kiểm chứng qua đồng thuận/phê duyệt.
3. `gem-kb`: Knowledge Base phục vụ hồ sơ đá tinh chế thông qua MCP Server và HTTP API.

```
┌─────────────────┐       RawDocument       ┌──────────────────────┐      StoneProfile      ┌─────────────────┐
│   gem-crawler   │ ──────────────────────> │ gem-data-processing  │ ─────────────────────> │     gem-kb      │
│  (CLI / Batch)  │   (Snapshot + Hash +    │ (LLM Fact Extraction │   (Verified Profiles   │  (MCP Server +  │
│                 │      Cleaned Text)      │   & Cross-checking)  │       & Release)       │    HTTP API)    │
└─────────────────┘                         └──────────────────────┘                        └─────────────────┘
```

Mọi thiết kế của `gem-crawler` phải tuân thủ nghiêm ngặt **5 Nguyên tắc Thiết kế Bất biến** `[HLD p.2]`:
- **Quy tắc 1 (Dữ liệu chảy một chiều):** `crawler` $\rightarrow$ `data-processing` $\rightarrow$ `kb`. Tuyệt đối không ghi ngược lên tầng trước.
- **Quy tắc 2 (Ranh giới ghi):** Chỉ `data-processing` được ghi vào KB. Crawler không có quyền truy cập KB.
- **Quy tắc 3 (Bảo tồn dữ liệu thô vĩnh viễn):** Giữ nguyên vẹn dữ liệu thô, không bao giờ xóa. Khi sửa đổi logic tinh chế, chỉ chạy lại `data-processing` mà không cần re-crawl.
- **Quy tắc 4 (Mọi fact đều có nguồn gốc):** Mọi tài liệu thô phải lưu đầy đủ URL gốc, ngày thu thập, tầng nguồn và định danh văn bản để truy vết nguồn gốc câu bằng chứng `[HLD p.2, p.5]`.
- **Quy tắc 5 (Luật tính toán là code):** Không đưa logic phán đoán phong thủy ngũ hành vào crawler.

---

## 2. RANH GIỚI MODULE & PHẠM VI CHỨC NĂNG (SCOPE & ANTI-SCOPE)

### 2.1. Phạm vi Hoạt động (In-Scope) `[HLD p.2-3]`
- **Môi trường Thực thi:** Chạy dưới dạng **công cụ CLI Batch trên máy tính cá nhân** của kỹ sư (macOS/Linux workstation), không phải là dịch vụ Web Server hoặc Daemon nền hoạt động 24/7 `[HLD p.2]`.
- **Nhiệm vụ cốt lõi:** Lấy trang web từ danh sách nguồn đã phân tầng, lưu snapshot HTML nguyên vẹn, bóc tách văn bản thô sạch rác (boilerplate removal), tính content hash và đóng gói bàn giao `RawDocument` `[HLD p.2]`.
- **Cơ chế thu thập:** Hỗ trợ crawling theo danh sách đá (`--stone`), theo tầng nguồn (`--tier`), hoặc chỉ crawl các loại đá đang có hàng sẵn (`--in-stock-only`) `[HLD p.6]`.

### 2.2. Những việc KHÔNG LÀM (Anti-Scope) `[HLD p.2-3]`
- **Tuyệt đối không chạy LLM:** Không phân tích ngữ nghĩa, không trích xuất fact, không tóm tắt hay suy luận trong crawler `[HLD p.2, p.3]`.
- **Không crawl sàn TMĐT:** Nghiêm cấm crawl Shopee, TikTok Shop, Lazada (do điều khoản dịch vụ cấm và nguy cơ dữ liệu cá nhân/giá rác) `[HLD p.3]`.
- **Không crawl Facebook Group:** Nghiêm cấm cào dữ liệu từ các nhóm kín Facebook `[HLD p.3]`.
- **Không quản lý giá bán, SKU và tồn kho:** Dữ liệu bán hàng thuộc về Sanity CMS của website thương mại, không nằm trong trách nhiệm của crawler `[HLD p.2]`.

---

## 3. KIẾN TRÚC CRAWLER CORE & CRAWLEE ENGINE

Hệ thống crawler được xây dựng trên nền tảng **Node.js LTS (v20+)** và **TypeScript 5.x**, sử dụng framework **Crawlee v3** (kế thừa các thư viện tiêu chuẩn công nghiệp: Playwright, Got-Scraping, Cheerio) `[HLD p.2]`.

```
                               ┌────────────────────────────────┐
                               │   gem-crawler CLI Dispatcher   │
                               └───────────────┬────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
         ┌───────────────────────────┐                   ┌───────────────────────────┐
         │      CheerioCrawler       │                   │     PlaywrightCrawler     │
         │  (HTTP / Tốc độ cực cao)  │                   │  (Headless Chromium / JS) │
         ├───────────────────────────┤                   ├───────────────────────────┤
         │ • Tầng 1: Wikipedia       │                   │ • Tầng 1: Mindat.org      │
         │ • Tầng 2: Blogs tĩnh      │                   │ • Tầng 1: GIA Encyclopedia│
         │ • Tầng 3: Diễn đàn tĩnh   │                   │ • Anti-bot JS Challenge   │
         │ • Tiêu thụ RAM: ~40MB     │                   │ • Tiêu thụ RAM: ~450MB    │
         └─────────────┬─────────────┘                   └─────────────┬─────────────┘
                       │                                               │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │  Crawlee AutoscaledPool Queue  │
                               │  - Respect robots.txt          │
                               │  - Per-domain rate limit       │
                               │  - SQLite Freshness Check      │
                               └────────────────────────────────┘
```

### 3.1. Phân bổ Engine linh hoạt (Dual-Engine Dispatcher)
Nhằm bảo vệ tài nguyên phần cứng máy local (RAM và CPU) trong khi vẫn đảm bảo thu thập đầy đủ nội dung từ các trang web phức tạp:

| Tiêu chí | `CheerioCrawler` | `PlaywrightCrawler` |
| :--- | :--- | :--- |
| **Giao thức** | HTTP Request thuần (`got-scraping`), parse HTML qua Cheerio. | Browser headless (Chromium engine thật). |
| **Mức tiêu thụ RAM** | **30MB – 60MB** / process. Rất nhẹ. | **300MB – 600MB** / browser context. |
| **Thời gian phản hồi** | **50ms – 200ms** / trang static. | **1500ms – 4000ms** / trang (chờ DOM hydration). |
| **Phạm vi chỉ định** | Nguồn Tầng 1 Wikipedia; Tầng 2 các blog phong thủy WordPress/Blogspot; Tầng 3 hỏi đáp. | Nguồn Tầng 1 Mindat.org (chứa bảng dữ liệu AJAX động, SVG cấu trúc tinh thể), GIA. |
| **Tối ưu hóa tài nguyên** | Mặc định sử dụng HTTP gzip. | Chặn tải tài nguyên dư thừa bằng `page.route`: hình ảnh, web fonts, video, stylesheet không cần thiết. |

### 3.2. Quản lý Hàng đợi & Session (RequestQueue & SessionPool)
- **RequestQueue bền bỉ (Persistent Storage):** Crawlee lưu trữ hàng đợi trực tiếp tại `storage/request_queues/`. Khi người dùng hủy lệnh (`Ctrl + C`), phiên làm việc có thể resume chính xác vị trí bị ngắt mà không crawl lặp lại.
- **Chuẩn hóa URL (Canonical Keying):** Để chống vòng lặp vô tận (infinite crawl loops) và tránh trùng lặp URL do query parameters:
  1. Chuẩn hóa protocol và host về chữ thường (`https://example.com`).
  2. Lược bỏ các tham số tracking tiếp thị: `utm_*`, `fbclid`, `gclid`, `ref`, `spm`, `_ga`.
  3. Sắp xếp các query parameter còn lại theo thứ tự ABC (`?a=1&b=2`).
  4. Lược bỏ hash fragment (`#section`).
- **SessionPool & Fingerprinting:**
  - Tích hợp `useFingerprints: true` trong `PlaywrightCrawler` qua module `fingerprint-generator`, tạo profile trình duyệt máy tính hợp lệ (User-Agent hiện đại, WebGL, HTTP/2).
  - Tự động gán điểm lỗi (`errorScore`) cho session khi gặp mã HTTP `403` hoặc `429`, kích hoạt thu hồi session (`session.retire()`) và đổi session mới.

### 3.3. Tôn trọng Robots.txt & Giới hạn Tốc độ (Domain-level Throttling)
- **robots.txt:** Kích hoạt thuộc tính `respectRobotsTxt: true` trong Crawlee `[HLD p.2]`. Hệ thống tự động fetch và cache `robots.txt`, lập tức từ chối đưa vào hàng đợi những đường dẫn bị máy chủ gốc cấm `Disallow`.
- **Domain-level Throttling (`sameDomainDelaySecs`):**
  - Nguồn Tầng 1 (Wikipedia, Mindat): `sameDomainDelaySecs: 2.0s` (tần suất $\le 0.5$ req/giây nhằm bảo vệ tài nguyên các tổ chức nghiên cứu khoa học cộng đồng).
  - Nguồn Tầng 2 & 3: `sameDomainDelaySecs: 1.5s – 3.0s`.
- **AutoscaledPool:** Tự động giám sát tải hệ thống máy local: nếu bộ nhớ RAM khả dụng giảm xuống dưới 15% hoặc CPU quá tải, Crawlee tự động hạ số luồng song song xuống mức tối thiểu (1 concurrent task).

### 3.4. Quản lý Tuổi thọ Dữ liệu & Freshness Cache TTL
HLD quy định: *"Bỏ qua trang đã lấy nếu chưa hết hạn"* `[HLD p.2]`.
Trước khi gửi network request, crawler thực hiện quy trình kiểm tra 2 lớp:

```
[Target URL] ───> [Kiểm tra SQLite url_cache]
                         │
                         ├── Còn hạn TTL? ──────── (CÓ) ───> [BỎ QUA (Skipped - Fresh)]
                         │                                    (Không tải mạng)
                        (KHÔNG)
                         │
                         ▼
                  [Gửi HTTP Request kèm ETag / If-Modified-Since]
                         │
                         ├── Trả về 304 Not Modified? ─── (CÓ) ───> [Cập nhật hạn expires_at]
                         │                                           (Không tạo snapshot mới)
                        (KHÔNG - 200 OK)
                         │
                         ▼
                  [Tiến hành Pipeline: Lưu Snapshot & Bóc tách Text]
```

**Bảng thời gian sống (TTL) theo tầng nguồn:**
- **Tầng 1 (Khoa học):** TTL = **60 ngày** (đặc tính vật lý, hóa học, hệ tinh thể là tri thức tĩnh).
- **Tầng 2 (Phong thủy uy tín):** TTL = **30 ngày** (quan điểm diễn giải và ý nghĩa dân gian ít thay đổi).
- **Tầng 3 (Hỏi đáp cộng đồng):** TTL = **14 ngày** (thảo luận có thể có cập nhật mới).
- **Bỏ qua kiểm tra (Override):** Khi người dùng truyền cờ CLI `--force`, crawler sẽ bỏ qua TTL và ETag để lấy dữ liệu mới nhất `[HLD p.2]`.

---

## 4. PIPELINE TIỀN XỬ LÝ & SNAPSHOT STORAGE ENGINE

### 4.1. Bóc tách Văn bản Sạch (Readability + Linkedom + Selectors)
Crawler không hiểu nội dung theo nghĩa ngữ nghĩa học (không LLM), nhưng phải làm sạch cấu trúc rác trước khi bàn giao `[HLD p.2]`.
- **Chiến lược Chọn lọc theo Tên miền (Domain Selectors):** Với các nguồn lớn (Wikipedia, Mindat), ưu tiên bóc tách trực tiếp theo selector chuyên biệt để đạt độ chính xác 100% (ví dụ: Wikipedia sử dụng `#mw-content-text .mw-parser-output`, đồng thời lược bỏ `.navbox`, `#toc`, `.reference`).
- **Chiến lược Phổ quát (Readability Engine):** Với các blog phong thủy tự do (Tầng 2 & 3), sử dụng thuật toán chấm điểm mật độ văn bản **`@mozilla/readability`** kết hợp **`linkedom`**.
  - `linkedom` nhẹ hơn `jsdom` gấp 10 lần về bộ nhớ và nhanh gấp 8-12 lần về tốc độ parse trong môi trường Node.js.
  - Tự động loại bỏ: thẻ quảng cáo, thanh điều hướng (navbar), chân trang (footer), banner, danh sách bài liên quan, khung bình luận.
- **Vệ sinh HTML (Sanitization):** Loại bỏ triệt để các thẻ nguy hiểm hoặc gây nhiễu token: `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<svg>`, `<canvas>`, inline event handlers.

### 4.2. Chuyển đổi Cleaned Markdown bảo toàn Bảng dữ liệu
Để tối ưu hóa chi phí token và hiệu quả trích xuất cho module `gem-data-processing` (nơi LLM sẽ chạy trích fact theo schema zod) `[HLD p.3]`:
- Sử dụng **`turndown`** cùng plugin **`turndown-plugin-gfm`** để chuyển đổi khối HTML đã làm sạch sang định dạng Markdown có cấu trúc.
- **Giá trị cốt lõi:** Bảo toàn nguyên vẹn **Bảng biểu (Markdown Tables)** chứa các thông số khoa học then chốt (độ cứng Mohs, tỷ trọng, hệ tinh thể, chỉ số khúc xạ) và cấu trúc danh sách, giúp LLM ở giai đoạn sau đọc chính xác không bị trượt dòng.

### 4.3. Thuật toán Content Hashing (Normalized SHA-256)
HLD quy định: *"Raw store: lưu snapshot kèm hash nội dung để phát hiện trang đã đổi"* `[HLD p.3]`.
Nếu hash trực tiếp trên Raw HTML, các yếu tố nhiễu như CSRF token, timestamp của server, banner quảng cáo xoay vòng sẽ làm hash bị sai lệch dù bài viết không đổi.

**Quy trình chuẩn hóa chuỗi trước khi tính Hash (Normalized Text Hashing):**
1. Lấy toàn bộ `cleaned_text` đã bóc tách.
2. Chuẩn hóa ký tự Unicode tiếng Việt theo chuẩn Unicode NFC (`text.normalize('NFC')`).
3. Cắt bỏ khoảng trắng thừa đầu và cuối mỗi dòng (`line.trim()`).
4. Gộp nhiều khoảng trắng/tab liên tiếp thành 1 dấu cách duy nhất (`\s+` $\rightarrow$ `' '`).
5. Loại bỏ các dòng trống vô nghĩa.
6. Chuyển toàn bộ về chữ thường (lowercase).
7. Tính toán mã băm:
   $$\text{content\_hash} = \text{SHA256}(\text{normalized\_text})$$
- **Change Detection:** So sánh mã băm mới với mã băm trong SQLite. Nếu trùng khớp, hệ thống ghi nhận `is_changed = false`, không cần tạo thêm file snapshot trùng lặp, chỉ cập nhật `last_checked_at`.

### 4.4. Cơ chế Nén và Lưu trữ Snapshot nguyên vẹn
HLD quy định: *"Giữ data thô, không xóa. Sửa logic tinh chế thì chỉ chạy lại data-processing, không phải crawl lại."* `[HLD p.2]`
- Lưu trữ snapshot HTML nguyên vẹn byte-for-byte dữ liệu nhận được từ máy chủ web.
- Áp dụng chuẩn nén **Gzip (`.html.gz`)** thông qua module gốc `node:zlib` của Node.js.
  - Tỷ lệ nén đối với tài liệu HTML đạt từ **75% – 85%** (1 file 250KB nén lại còn ~35KB).
  - Tách rời snapshot ra khỏi cơ sở dữ liệu SQLite để tránh phân mảnh DB và đảm bảo SQLite luôn có kích thước siêu nhẹ.

---

## 5. ĐẶC TẢ HỢP ĐỒNG DỮ LIỆU RAWDOCUMENT V1.0.0 (DATA CONTRACT)

Theo quy định kiến trúc tại Trang 5 của HLD: *"Vì 3 project tách repo và không có package dùng chung, mỗi ranh giới do project phía trước sở hữu và xuất ra dưới dạng JSON Schema có version. Ranh giới crawler $\rightarrow$ data-processing do gem-crawler sở hữu, bên nhận kiểm tra bằng JSON Schema đi kèm mỗi lần chạy crawl."* `[HLD p.5]`

### 5.1. Định dạng JSON Schema Draft 2020-12
Tệp schema được lưu trữ chính thức tại: `gem-crawler/schemas/raw-document.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://omnigem.org/schemas/v1/raw-document.schema.json",
  "title": "RawDocument",
  "description": "Bản hợp đồng dữ liệu chuẩn đầu ra của gem-crawler bàn giao cho gem-data-processing theo kiến trúc HLD OmniGem (Trang 2 & Trang 5)",
  "type": "object",
  "required": [
    "schema_version",
    "id",
    "run_id",
    "target_stone",
    "source_tier",
    "original_url",
    "canonical_url",
    "crawl_timestamp",
    "http_status",
    "content_hash",
    "raw_html_path",
    "cleaned_text",
    "page_title"
  ],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0.0" },
    "id": { "type": "string", "format": "uuid" },
    "run_id": { "type": "string", "format": "uuid" },
    "target_stone": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    "source_tier": { "type": "integer", "enum": [1, 2, 3] },
    "original_url": { "type": "string", "format": "uri" },
    "canonical_url": { "type": "string", "format": "uri" },
    "crawl_timestamp": { "type": "string", "format": "date-time" },
    "http_status": { "type": "integer", "minimum": 200, "maximum": 599 },
    "response_headers": {
      "type": "object",
      "properties": {
        "etag": { "type": "string" },
        "last-modified": { "type": "string" },
        "content-type": { "type": "string" }
      },
      "additionalProperties": true
    },
    "page_title": { "type": "string" },
    "content_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "raw_html_path": { "type": "string" },
    "raw_html_size_bytes": { "type": "integer", "minimum": 0 },
    "compressed_size_bytes": { "type": "integer", "minimum": 0 },
    "cleaned_text": { "type": "string" },
    "cleaned_markdown": { "type": "string" },
    "extractor_metadata": {
      "type": "object",
      "properties": {
        "engine": { "type": "string", "enum": ["cheerio", "playwright"] },
        "strategy": { "type": "string", "enum": ["readability-linkedom", "domain-selector", "fallback"] },
        "word_count": { "type": "integer", "minimum": 0 },
        "character_count": { "type": "integer", "minimum": 0 },
        "language_detected": { "type": "string" },
        "execution_duration_ms": { "type": "integer", "minimum": 0 }
      },
      "required": ["engine", "strategy", "word_count"],
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 5.2. TypeScript Interface Chuẩn
```typescript
export type SourceTier = 1 | 2 | 3;

export interface RawDocumentV1 {
  schema_version: '1.0.0';
  id: string; // UUID v4
  run_id: string; // UUID v4
  target_stone: string; // Slug định danh, ví dụ: "thach-anh-hong"
  source_tier: SourceTier; // 1: Khoa học | 2: Phong thủy tiếng Việt | 3: Hỏi đáp
  original_url: string; // URL bắt đầu request
  canonical_url: string; // URL đích chuẩn hóa
  crawl_timestamp: string; // Chuẩn ISO 8601 UTC
  http_status: number; // 200, 304...
  response_headers?: {
    etag?: string;
    'last-modified'?: string;
    'content-type'?: string;
    [header: string]: string | undefined;
  };
  page_title: string;
  content_hash: string; // SHA-256 (64 hex characters)
  raw_html_path: string; // Đường dẫn tương đối: "snapshots/tier-1/thach-anh-hong/abc.html.gz"
  raw_html_size_bytes?: number;
  compressed_size_bytes?: number;
  cleaned_text: string; // Text thuần đã làm sạch
  cleaned_markdown?: string; // Markdown có cấu trúc giữ bảng dữ liệu
  extractor_metadata: {
    engine: 'cheerio' | 'playwright';
    strategy: 'readability-linkedom' | 'domain-selector' | 'fallback';
    word_count: number;
    character_count?: number;
    language_detected?: string;
    execution_duration_ms?: number;
  };
}
```

### 5.3. Quy trình Kiểm định Hợp đồng (Contract Validation)
- `gem-crawler` tích hợp thư viện **`ajv`** (hỗ trợ `ajv-formats`) để validate độc lập từng bản ghi `RawDocument` trước khi ghi vào SQLite hoặc xuất ra file bàn giao.
- Khi lệnh `export` được chạy, crawler tự động sao chép tệp `raw-document.schema.json` vào thư mục xuất khẩu (`exports/schemas/`) để `gem-data-processing` có thể kiểm tra schema tự động ở bước tiếp nhận `[HLD p.5]`.

---

## 6. THIẾT KẾ SOURCE REGISTRY & PHÂN TẦNG TIN CẬY

HLD quy định: *"Source registry: danh sách nguồn, mỗi nguồn gắn tầng: tầng 1 khoa học, tầng 2 phong thủy tiếng Việt, tầng 3 hỏi đáp."* `[HLD p.2]`

### 6.1. Cấu trúc Nguồn Tầng 1, 2, 3

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Source Registry (3 Tầng)                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐       ┌───────────────────────┐
│        TẦNG 1         │       │        TẦNG 2         │       │        TẦNG 3         │
│  (Khoa học / Chuẩn)   │       │ (Phong thủy uy tín)   │       │   (Hỏi đáp / Forum)   │
├───────────────────────┤       ├───────────────────────┤       ├───────────────────────┤
│ • Wikipedia (vi, en)  │       │ • Phong Thủy An Phát  │       │ • Webtretho phong thủy│
│ • Mindat.org          │       │ • Blog Đá Quý VN      │       │ • Diễn đàn cộng đồng  │
│ • GIA Encyclopedia    │       │ • Tạp chí trang sức   │       │ • Q&A hỏi đáp đá quý  │
│ TTL: 60 - 90 ngày     │       │ TTL: 30 ngày          │       │ TTL: 14 ngày          │
└───────────────────────┘       └───────────────────────┘       └───────────────────────┘
```

- **Tầng 1 (Khoa học - Scientific Knowledge):** Wikipedia (`vi.wikipedia.org`, `en.wikipedia.org`), Mindat (`mindat.org`), Bách khoa đá quý của các viện kiểm định uy tín (GIA, SSEF, Gübelin, VGC Việt Nam).
  - *Đặc điểm:* Cung cấp trường dữ liệu khoa học thuần túy (thành phần hóa học, độ cứng Mohs, hệ tinh thể, chiết suất, tỷ trọng, dấu hiệu xử lý nhân tạo) `[HLD p.2, p.4]`.
- **Tầng 2 (Phong thủy Tiếng Việt - Vietnamese Cultural & Feng Shui Context):** Các bài viết chuyên luận từ các chuyên gia đá phong thủy uy tín tại Việt Nam.
  - *Đặc điểm:* Cung cấp tri thức về ngũ hành, quan hệ sinh/khắc theo mệnh, màu sắc đại diện, ý nghĩa văn hóa dân gian `[HLD p.2]`.
- **Tầng 3 (Hỏi đáp & Thảo luận Cộng đồng - Community Q&A):** Các chủ đề hỏi đáp, tư vấn thắc mắc của người tiêu dùng trên diễn đàn hoặc chuyên mục hỏi đáp.
  - *Đặc điểm:* Cung cấp góc nhìn thực tế của người dùng: cách phân biệt thật giả thông thường, thắc mắc kiêng kỵ thường gặp để xây dựng FAQ và kịch bản video `[HLD p.2, p.4, p.5]`.

### 6.2. Danh mục Đá Mục tiêu (Seed Stones) & Ưu tiên Hàng có sẵn
HLD quy định: *"Bước nào cũng bắt đầu từ các loại đá đang có hàng ở cửa hàng, rồi mới mở rộng ra cả seed list."* `[HLD p.6]`
- Tệp cấu hình `config/seed-stones.json` lưu trữ:
  - Mã slug đá (`slug`).
  - Tên gọi chính (`primary_name`).
  - Danh sách tên gọi khác / biệt danh (`aliases` - phục vụ chuẩn hóa ở bước sau) `[HLD p.2, p.3]`.
  - Trạng thái có hàng tại cửa hàng (`in_stock: true | false`).
  - Mức độ ưu tiên (`priority: 1 | 2`).
  - Danh sách từ khóa tìm kiếm (`search_keywords`).

---

## 7. KIẾN TRÚC LƯU TRỮ CỤC BỘ (HYBRID STORAGE: SQLITE + FILESYSTEM)

HLD quy định: *"Lưu trữ: File JSON hoặc SQLite cục bộ, chia theo lần chạy. Giữ data thô, không xóa."* `[HLD p.2, p.3]`

Nhằm giải quyết triệt để nguy cơ phình to database cục bộ (tránh lưu hàng trăm megabyte chuỗi HTML trực tiếp vào SQLite) trong khi vẫn đảm bảo hiệu năng truy vấn siêu nhanh:

### 7.1. Database Schema DDL (SQLite WAL Mode)

```sql
-- Kích hoạt Write-Ahead Logging để tăng tốc độ ghi và không chặn truy vấn đọc
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Bảng quản lý phiên chạy crawl batch CLI
CREATE TABLE IF NOT EXISTS crawl_runs (
    id TEXT PRIMARY KEY,                       -- UUID v4 định danh run
    started_at TEXT NOT NULL,                  -- ISO 8601 UTC
    finished_at TEXT,                          -- ISO 8601 UTC
    command_args TEXT,                         -- JSON string lưu cờ CLI
    status TEXT NOT NULL CHECK(status IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED')),
    total_processed INTEGER DEFAULT 0,
    total_new INTEGER DEFAULT 0,
    total_updated INTEGER DEFAULT 0,
    total_skipped INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0
);

-- 2. Bảng đăng ký danh bạ nguồn (Source Registry)
CREATE TABLE IF NOT EXISTS registered_sources (
    id TEXT PRIMARY KEY,                       -- vd: "wiki-vi"
    domain TEXT NOT NULL UNIQUE,               -- vd: "vi.wikipedia.org"
    source_tier INTEGER NOT NULL CHECK(source_tier IN (1, 2, 3)),
    engine_preference TEXT DEFAULT 'auto' CHECK(engine_preference IN ('cheerio', 'playwright', 'auto')),
    default_delay_sec REAL DEFAULT 1.5,
    custom_selectors TEXT,                     -- JSON cấu hình selector
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

-- 3. Bảng Raw Documents (Metadata và Nội dung văn bản sạch)
CREATE TABLE IF NOT EXISTS raw_documents (
    id TEXT PRIMARY KEY,                       -- UUID v4
    run_id TEXT NOT NULL REFERENCES crawl_runs(id),
    target_stone TEXT NOT NULL,                -- Slug đá (vd: "thach-anh-hong")
    source_tier INTEGER NOT NULL CHECK(source_tier IN (1, 2, 3)),
    canonical_url TEXT NOT NULL,
    original_url TEXT NOT NULL,
    crawl_timestamp TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    page_title TEXT,
    content_hash TEXT NOT NULL,                -- SHA-256 của normalized cleaned text
    raw_html_path TEXT NOT NULL,               -- Đường dẫn tương đối trỏ file .html.gz
    raw_html_size_bytes INTEGER,
    compressed_size_bytes INTEGER,
    cleaned_text TEXT NOT NULL,
    cleaned_markdown TEXT,
    extractor_metadata TEXT,                   -- JSON thông số trích xuất
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL                   -- Thời hạn TTL
);

-- 4. Bảng Cache & Freshness kiểm tra nhanh URL
CREATE TABLE IF NOT EXISTS url_cache (
    canonical_url TEXT PRIMARY KEY,
    etag TEXT,
    last_modified TEXT,
    content_hash TEXT,
    last_crawled_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_status_code INTEGER NOT NULL,
    source_tier INTEGER NOT NULL
);

-- 5. Bảng ghi nhận lỗi crawl phục vụ kiểm toán (Audit Trail)
CREATE TABLE IF NOT EXISTS crawl_errors (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES crawl_runs(id),
    url TEXT NOT NULL,
    target_stone TEXT,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    retry_count INTEGER DEFAULT 0,
    failed_at TEXT NOT NULL
);

-- Chỉ mục tối ưu hóa tốc độ tìm kiếm
CREATE INDEX IF NOT EXISTS idx_raw_docs_stone ON raw_documents(target_stone);
CREATE INDEX IF NOT EXISTS idx_raw_docs_tier ON raw_documents(source_tier);
CREATE INDEX IF NOT EXISTS idx_raw_docs_hash ON raw_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_raw_docs_run ON raw_documents(run_id);
CREATE INDEX IF NOT EXISTS idx_url_cache_expires ON url_cache(expires_at);
```

### 7.2. Cấu trúc Thư mục Dự án và Lưu trữ Dữ liệu

```
gem-crawler/
├── High-Level Design.pdf        # Tài liệu kiến trúc cấp cao gốc
├── package.json                 # Khai báo dependency và CLI bin
├── tsconfig.json                # Cấu hình TypeScript 5 strict mode
├── schemas/
│   └── raw-document.schema.json # Hợp đồng dữ liệu JSON Schema v1.0.0
├── config/
│   ├── sources.json             # Cấu hình danh mục nguồn phân tầng 1, 2, 3
│   └── seed-stones.json         # Danh mục đá, tên gọi khác, từ khóa, tồn kho
├── data/
│   ├── crawler.db               # SQLite metadata database (không commit git)
│   ├── crawler.db-wal           # SQLite Write-Ahead Log
│   └── snapshots/               # Thư mục lưu snapshot nén (không commit git)
│       ├── tier-1/
│       │   └── thach-anh-hong/
│       │       └── 20261002_a1b2c3d4.html.gz
│       ├── tier-2/
│       └── tier-3/
├── exports/                     # Thư mục bàn giao cho gem-data-processing
│   ├── run_20261002_01.ndjson   # Dữ liệu xuất dạng Newline Delimited JSON
│   └── schemas/
│       └── raw-document.schema.json
├── docs/
│   └── CRAWLER_TOOLS_SPECIFICATION.md # Bản tài liệu này
└── src/
    ├── index.ts                 # CLI entry point
    ├── cli/                     # Định nghĩa các lệnh CLI (Commander)
    ├── core/
    │   ├── dispatcher.ts        # Bộ điều phối Dual-Engine
    │   ├── cheerio-engine.ts    # Cheerio Crawler
    │   └── playwright-engine.ts # Playwright Crawler
    ├── extractors/
    │   ├── readability.ts       # Mozilla Readability + Linkedom
    │   ├── markdown.ts          # Turndown Markdown Converter
    │   └── hasher.ts            # Normalized Text SHA-256 Hasher
    └── storage/
        ├── db.ts                # Better-sqlite3 wrapper
        ├── snapshot-store.ts    # Gzip file compression & disk storage
        └── exporter.ts          # Module export NDJSON bàn giao
```

---

## 8. BỘ CÔNG CỤ DÒNG LỆNH (CLI TOOLS SUITE)

HLD quy định: *"Nó chạy batch trên máy của bạn bằng lệnh CLI, không phải server."* `[HLD p.2]`

Giao diện dòng lệnh được triển khai thông qua thư viện `commander` kết hợp `@clack/prompts` và `picocolors` nhằm đem lại trải nghiệm vận hành dòng lệnh chuyên nghiệp.

### 8.1. Danh mục Lệnh CLI

```
Cú pháp: gem-crawler <command> [options]

Các lệnh hỗ trợ:
  crawl       Khởi chạy phiên batch crawl thu thập dữ liệu web
  sources     Quản lý, kiểm tra danh bạ nguồn và test robots.txt
  verify      Kiểm toán tính toàn vẹn dữ liệu, hash, snapshot và schema
  inspect     Xem nhanh nội dung text, markdown hoặc metadata của tài liệu
  export      Đóng gói và xuất dữ liệu RawDocument bàn giao cho Stage 2
```

### 8.2. Chi tiết Lệnh & Kịch bản Vận hành

#### Lệnh 1: `gem-crawler crawl`
Thực thi thu thập tài liệu hàng loạt:
```bash
# 1. Thu thập dữ liệu loại đá cụ thể cho mọi tầng nguồn:
gem-crawler crawl --stone thach-anh-hong

# 2. Thu thập chỉ các loại đá cửa hàng đang có hàng cho Tầng 1 và Tầng 2:
# (Tuân thủ chỉ dẫn ưu tiên tại HLD p.6)
gem-crawler crawl --in-stock-only --tier 1,2

# 3. Ép buộc crawl lại toàn bộ (bỏ qua Cache TTL và ETag):
gem-crawler crawl --stone ngoc-bich --force

# 4. Chạy giả lập (Dry run) để kiểm tra danh sách URL và trạng thái cache trước khi tải thật:
gem-crawler crawl --stone aquamarine --dry-run

# 5. Điều chỉnh mức độ tải mạng và concurrency:
gem-crawler crawl --concurrency 3 --delay 2.0
```

#### Lệnh 2: `gem-crawler sources`
Quản trị danh bạ nguồn:
```bash
# Liệt kê các nguồn đã đăng ký kèm tầng nguồn và cấu hình engine:
gem-crawler sources list

# Kiểm tra trạng thái robots.txt của tất cả các domain đăng ký:
gem-crawler sources check-robots

# Chạy thử nghiệm bóc tách trên 1 URL cụ thể:
gem-crawler sources test-url https://vi.wikipedia.org/wiki/Th%E1%BA%A1ch_anh_h%E1%BB%93ng
```

#### Lệnh 3: `gem-crawler verify`
Kiểm toán dữ liệu và tính hợp lệ của hợp đồng:
```bash
gem-crawler verify
```
- Quét toàn bộ SQLite DB và đối chiếu với hệ thống file trên đĩa.
- Kiểm tra xem mọi `raw_html_path` có file `.html.gz` tồn tại thực tế trên đĩa không.
- Tính toán lại SHA-256 trên `cleaned_text` để đảm bảo không bị hỏng hóc dữ liệu.
- Chạy validator `ajv` kiểm tra từng bản ghi đối chiếu với `raw-document.schema.json`.

#### Lệnh 4: `gem-crawler inspect`
Kiểm tra nhanh tài liệu trên terminal:
```bash
# Xem văn bản Markdown đã làm sạch của một URL:
gem-crawler inspect --url "https://vi.wikipedia.org/wiki/Thạch_anh_hồng" --view markdown

# Xem thông tin metadata của một Document ID:
gem-crawler inspect --id "550e8400-e29b-41d4-a716-446655440000"
```

#### Lệnh 5: `gem-crawler export`
Đóng gói dữ liệu bàn giao cho `gem-data-processing`:
```bash
# Xuất dữ liệu của phiên chạy gần nhất ra file NDJSON:
gem-crawler export --run-id latest --format ndjson --output ./exports/run_latest.ndjson

# Xuất dữ liệu theo loại đá:
gem-crawler export --stone thach-anh-hong --output ./exports/thach-anh-hong/
```

---

## 9. CHIẾN LƯỢC XỬ LÝ LỖI, PHỤC HỒI & PHÒNG CHỐNG CHẶN (ANTI-BLOCKING)

Nhằm đảm bảo quá trình thu thập diễn ra bền bỉ, không làm nghẽn mạng gia đình/văn phòng và không vi phạm đạo đức mạng:

1. **Chiến lược Thử lại Hàm mũ (Exponential Backoff with Jitter):**
   - Khi gặp lỗi mạng tạm thời hoặc phản hồi HTTP `500`, `502`, `503`, `504`, Crawlee tự động thử lại tối đa 3 lần.
   - Thời gian trễ giữa các lần thử:
     $$T_{\text{wait}} = 2^{\text{retryCount}} \times 1000\text{ms} + \text{random}(200\text{ms}, 800\text{ms})$$
2. **Xử lý Mã lỗi HTTP `429 Too Many Requests`:**
   - Đọc giá trị header `Retry-After` từ máy chủ mục tiêu.
   - Nếu có, crawler đưa URL về cuối hàng đợi và tạm dừng mọi request đến domain đó cho đến khi hết thời gian yêu cầu.
3. **Phòng tránh OOM (Out Of Memory) trên Máy Local:**
   - Trong quá trình Playwright vận hành, mỗi tab Chromium ngốn bộ nhớ lớn. Hệ thống kích hoạt cơ chế tái tạo ngữ cảnh trình duyệt (Browser Context Recycling) sau mỗi 50 trang crawl để giải phóng triệt để bộ nhớ đệm Chromium.
4. **Ghi nhận Nhật ký Lỗi Toàn diện (Audit Trail):**
   - Mọi URL thất bại sau 3 lần thử lại đều được lưu vào bảng `crawl_errors` trong SQLite kèm mã lỗi, stack trace và timestamp để người vận hành kiểm tra qua CLI.

---

## 10. HỆ THỐNG DẪN CHỨNG & TRÍCH DẪN (CITATIONS & REFERENCES)

### 10.1. Dẫn chứng trực tiếp từ Tài liệu Thiết kế Cấp cao (HLD)

| Ký hiệu | Vị trí trong HLD | Nội dung quy định gốc từ HLD | Áp dụng trong Bản đặc tả Crawler Tools |
| :--- | :--- | :--- | :--- |
| **`[HLD-01]`** | Trang 1, Mục *"Tổng quan"* | Tri thức đi một chiều qua 3 project: `gem-crawler` lấy thô, `gem-data-processing` tinh chế, `gem-kb` phục vụ. | Thiết kế ranh giới một chiều, crawler không phụ thuộc vào KB hay LLM. |
| **`[HLD-02]`** | Trang 2, Mục *"Nguyên tắc thiết kế #1-#5"* | 5 quy tắc: dữ liệu một chiều; chỉ data-processing ghi KB; giữ data thô không xóa; mỗi fact có nguồn; luật tính toán là code. | Bảo tồn snapshot HTML nguyên vẹn vĩnh viễn; lưu URL và bằng chứng nguồn cho mọi bản ghi. |
| **`[HLD-03]`** | Trang 2, Mục *"gem-crawler"* | Chạy batch trên máy local bằng CLI, không phải server. Đầu vào: config seed list + nguồn theo tầng tin cậy + từ khóa. Đầu ra: `RawDocument`. Lưu trữ: JSON/SQLite cục bộ theo lần chạy. Stack: Node/TypeScript, Crawlee. | Thiết kế bộ lệnh CLI (`commander`), SQLite WAL mode, schema phân tầng T1/T2/T3. |
| **`[HLD-04]`** | Trang 2, Mục *"Thành phần chính"* | Source registry phân tầng: T1 khoa học, T2 phong thủy VN, T3 hỏi đáp. Fetcher tuân thủ `robots.txt`, rate limit domain, bỏ qua trang nếu chưa hết hạn. | Triển khai `respectRobotsTxt`, `sameDomainDelaySecs`, Cache TTL 60d/30d/14d và ETag. |
| **`[HLD-05]`** | Trang 3, Mục *"Raw store & Không làm"* | Raw store lưu snapshot kèm hash nội dung để phát hiện trang đổi. Không crawl sàn TMĐT (Shopee, TikTok Shop, Lazada), không crawl group Facebook. Không chạy LLM. | Normalized SHA-256 Text Hashing; loại bỏ hoàn toàn các trang TMĐT và Facebook khỏi registry. |
| **`[HLD-06]`** | Trang 3, Mục *"gem-data-processing"* | Tiếp nhận `RawDocument` từ crawler để trích fact theo schema zod, chuẩn hóa tên đá (slug), so độ trùng văn bản. | Cung cấp Cleaned Text và Cleaned Markdown tối ưu cấu trúc bảng để LLM trích fact chuẩn xác. |
| **`[HLD-07]`** | Trang 4, Mục *"gem-kb"* | KB phục vụ hồ sơ đá tinh chế, trường khoa học chỉ nhận từ nguồn Tầng 1. | Gắn nhãn cứng `source_tier: 1 | 2 | 3` trong metadata `RawDocument` để downstream lọc đúng. |
| **`[HLD-08]`** | Trang 5, Mục *"Hợp đồng dữ liệu"* | Ranh giới crawler $\rightarrow$ data-processing: Hợp đồng `RawDocument`, chủ sở hữu là `gem-crawler`, bên nhận kiểm tra bằng JSON Schema đi kèm mỗi lần chạy. | Đóng gói JSON Schema Draft 2020-12 chính thức tại `schemas/raw-document.schema.json`. |
| **`[HLD-09]`** | Trang 6, Mục *"Lộ trình"* | Bước nào cũng bắt đầu từ các loại đá đang có hàng ở cửa hàng, rồi mới mở rộng ra cả seed list. | Thiết kế cờ CLI `--in-stock-only` và trường `in_stock: boolean` trong cấu hình đá mục tiêu. |

### 10.2. Dẫn chứng Tiêu chuẩn Kỹ thuật & Thư viện Quốc tế

1. **Crawlee v3 Architecture Guide (Apify):**
   - Hướng dẫn thiết kế Autoscaling, SessionPool, RequestQueue và Dual-Crawler (`CheerioCrawler` & `PlaywrightCrawler`).
   - Tài liệu tham chiếu: [https://crawlee.dev](https://crawlee.dev)
2. **Mozilla Readability (`@mozilla/readability`):**
   - Thuật toán trích xuất nội dung cốt lõi của Mozilla Firefox Reader View.
   - Tài liệu tham chiếu: [https://github.com/mozilla/readability](https://github.com/mozilla/readability)
3. **IETF RFC 9110 (HTTP Semantics):**
   - Tiêu chuẩn Conditional Requests (`ETag`, `If-None-Match`, `Last-Modified`, `If-Modified-Since`, mã phản hồi `304 Not Modified`).
4. **JSON Schema Specification (Draft 2020-12):**
   - Tiêu chuẩn định nghĩa cấu trúc hợp đồng dữ liệu hướng đối tượng hiện đại.
   - Tài liệu tham chiếu: [https://json-schema.org/draft/2020-12/release-notes](https://json-schema.org/draft/2020-12/release-notes)
5. **SQLite Consortium WAL Mode Technical Note:**
   - Cơ chế Write-Ahead Logging nhằm tối ưu hóa ghi đồng thời và ngăn ngừa khóa database trên local file system.
   - Tài liệu tham chiếu: [https://www.sqlite.org/wal.html](https://www.sqlite.org/wal.html)
