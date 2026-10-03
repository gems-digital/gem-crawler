---
name: gem-crawler-ops
description: Comprehensive operational runbook for running batch crawls, verifying data integrity, inspecting snapshots, and exporting datasets for OmniGem Knowledge Platform.
---

# Gem Crawler Operational Guide

Use this skill when tasked with running crawls, checking crawl status, diagnosing failed extraction, or exporting raw documents.

## 1. Safety & Concurrency Guidelines
- **Always respect rate limits:** The default delay is 1.5 seconds per domain. Do not lower delay below 1.0s without explicit instructions.
- **Concurrency:** Maximum 5 concurrent requests for Tier 1 sources; maximum 3 for Tier 2/3 sources.
- **Avoid duplicate fetches:** Check existing data via `get_crawler_stats` before triggering full crawls.

## 2. Long-running Task Protocol
Crawling is IO-bound and may take several minutes to complete:
1. When running a crawl command via shell, run it as a background task if it takes more than 10 seconds:
   - Command: `node dist/index.js crawl --stone <slug> [--tier <1,2>]`
2. Monitor background tasks with `manage_task(Action='status')` or by querying `data/crawler.db` via `get_crawler_stats`.
3. Do not spam status checks in a busy loop; use reactive wakeup or wait for completion.

## 3. Post-crawl Verification Gate
Always execute verification after a crawl finishes:
```bash
node dist/index.js verify
```
Verify checks:
- SQLite table integrity and foreign keys.
- Hash consistency of extracted text.
- Gzip snapshot decompression and existence on disk.
- JSON Schema compliance against `schemas/raw-document.schema.json`.

## 4. Exporting Data
To hand over raw documents to the `gem-data-processing` refinement pipeline:
```bash
node dist/index.js export --run-id latest --output ./exports/run_latest.ndjson
```
