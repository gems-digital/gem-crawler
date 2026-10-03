# Antigravity Agent Rules for gem-crawler

## 1. Project Context & Mission
You are working on **`gem-crawler`**, the CLI Batch Crawler & Snapshot Archiver for the **OmniGem Knowledge Platform**.
Your mission is to collect raw web data, preserve untouched HTML snapshots, clean boilerplate text, and produce standardized `RawDocumentV1` records for downstream processing (`gem-data-processing`).

## 2. Core Architecture Tenets (Non-negotiable)
1. **One-way Data Flow:** `gem-crawler` -> `gem-data-processing` -> `gem-kb`. Never import or couple crawler logic with downstream processing.
2. **Local Batch CLI Only:** This is not a 24/7 web server or daemon. It executes on-demand batch runs.
3. **No Semantic LLM Processing:** The crawler MUST NOT call LLM APIs for summarization, sentiment, or entity extraction. Its sole purpose is deterministic ELT: Fetch, Clean boilerplate (Readability/Turndown), Compute SHA-256 Hash, and Archive.
4. **Snapshot Preservation:** Raw HTML snapshots must be compressed using gzip (`.html.gz`) and saved under `data/snapshots/{tier}/{stone}/`. Never store uncompressed raw HTML dumps directly in SQLite.
5. **Ethical & Compliant Crawling:**
   - Always respect `robots.txt`.
   - Adhere to per-domain rate limiting (`rate_limit_delay_ms`, minimum 1.5s).
   - Honor TTL and ETag: skip pages whose TTL is still valid unless `--force` is specified.
   - Prohibited domains: Do not crawl e-commerce platforms (Shopee, Lazada, TikTok Shop) or social media groups.
6. **Data Contract Compliance:** All saved documents must strictly adhere to [`schemas/raw-document.schema.json`](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/schemas/raw-document.schema.json).

## 3. Standard CLI Workflows
- **Crawl a stone:** `node dist/index.js crawl --stone <slug> [--tier <1,2>] [--in-stock-only]`
- **Audit & Verify:** `node dist/index.js verify`
- **Inspect item:** `node dist/index.js inspect --id <uuid>` or `--url <url>`
- **Export data:** `node dist/index.js export --run-id latest --output ./exports/run_latest.ndjson`
- **Build TypeScript:** `npm run build`

## 4. Verification Protocol
Whenever modifying TypeScript code in `src/`:
1. Run `npm run build` to guarantee compilation.
2. Run `node dist/index.js verify` to check schema validity and SQLite database integrity.
