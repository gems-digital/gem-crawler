# Crawler Implementation Guidelines & Safety Rules

## 1. Storage & Database Rules
- **SQLite Database:** Located at `data/crawler.db`. Uses WAL mode (`PRAGMA journal_mode = WAL`) and foreign keys enabled.
- **Transactions:** Batch document inserts and cache updates must use SQLite transactions (`db.transaction(...)`) to prevent DB corruption during sudden interrupts.
- **Content Deduplication:** Check `content_hash` before writing to `raw_documents`. If content hash exists, mark status as `SKIPPED_DUPLICATE` or update timestamp without duplicate snapshot save.

## 2. Extraction & Cleaning Rules
- **Boilerplate Removal:** Use `@mozilla/readability` and `linkedom`/`cheerio` to strip navigation bars, footers, comment sections, and advertisement iframes.
- **Markdown Conversion:** Convert sanitized HTML into Markdown using `turndown` with `turndown-plugin-gfm`. Preserve meaningful table structures and image links.
- **Hash Computation:** Canonical SHA-256 computed on normalized extracted plain text, not on raw noisy HTML headers.

## 3. Crawler Engine Selection
- Tier 1 (Scientific & Academic): Cheerio (fast, low footprint).
- Tier 2 & 3 (Institutes & Trade): Auto/Playwright only when dynamic JavaScript rendering is strictly necessary.
- Concurrency limit: Default to 5. Never exceed 10 concurrent requests to respect origin servers.
