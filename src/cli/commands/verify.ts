import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { CrawlerDatabase } from '../../storage/db.js';
import { SnapshotStore } from '../../storage/snapshot-store.js';
import { computeContentHash } from '../../extractors/hasher.js';

export function makeVerifyCommand(): Command {
  const cmd = new Command('verify');
  cmd.description('Kiểm toán dữ liệu, tính toàn vẹn hash, snapshot và JSON Schema');

  cmd.action(async () => {
    console.log(`\n🔍 Starting Data & Schema Verification Audit...`);

    const db = new CrawlerDatabase();
    const snapshotStore = new SnapshotStore();

    try {
      // 1. Load schema
      const schemaPath = path.resolve(process.cwd(), 'schemas', 'raw-document.schema.json');
      const schemaRaw = await fs.readFile(schemaPath, 'utf8');
      const schema = JSON.parse(schemaRaw);

      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      const docs = db.getDocuments();
      console.log(`Checking ${docs.length} documents in SQLite database...`);

      let validCount = 0;
      let schemaErrors = 0;
      let snapshotMissing = 0;
      let hashMismatch = 0;

      for (const doc of docs) {
        const docId = doc.id;
        // A. Validate JSON Schema
        const isValidSchema = validate(doc);
        if (!isValidSchema) {
          schemaErrors++;
          console.warn(`⚠️ [Schema Error] Doc ID ${docId}:`, validate.errors);
        }

        // B. Check snapshot on disk
        const snapshotExists = await snapshotStore.exists(doc.raw_html_path);
        if (!snapshotExists) {
          snapshotMissing++;
          console.warn(`⚠️ [Missing Snapshot] File not found: ${doc.raw_html_path}`);
        }

        // C. Check content hash
        const computedHash = computeContentHash(doc.cleaned_text);
        if (computedHash !== doc.content_hash) {
          hashMismatch++;
          console.warn(`⚠️ [Hash Mismatch] Doc ID ${doc.id}: stored=${doc.content_hash}, computed=${computedHash}`);
        }

        if (isValidSchema && snapshotExists && computedHash === doc.content_hash) {
          validCount++;
        }
      }

      console.log(`\n======================================================`);
      console.log(`📊 Audit Summary:`);
      console.log(`- Total Documents : ${docs.length}`);
      console.log(`- 100% Valid      : ${validCount}`);
      console.log(`- Schema Errors   : ${schemaErrors}`);
      console.log(`- Missing Snapshot: ${snapshotMissing}`);
      console.log(`- Hash Mismatches : ${hashMismatch}`);
      console.log(`======================================================\n`);
    } catch (err) {
      console.error(`❌ Verification failed:`, err);
    } finally {
      db.close();
    }
  });

  return cmd;
}
