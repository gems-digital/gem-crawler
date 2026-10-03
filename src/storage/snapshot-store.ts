import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { SourceTier } from '../types/index.js';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface SnapshotSaveResult {
  relativePath: string;
  rawSizeBytes: number;
  compressedSizeBytes: number;
}

export class SnapshotStore {
  private baseDir: string;

  constructor(baseDir: string = path.resolve(process.cwd(), 'data', 'snapshots')) {
    this.baseDir = baseDir;
  }

  /**
   * Compresses and saves raw HTML snapshot to disk according to hierarchical tier/stone directory.
   */
  async saveSnapshot(
    rawHtml: string,
    tier: SourceTier,
    targetStone: string,
    contentHash: string
  ): Promise<SnapshotSaveResult> {
    const rawBuffer = Buffer.from(rawHtml, 'utf8');
    const rawSizeBytes = rawBuffer.length;
    const compressedBuffer = await gzipAsync(rawBuffer);
    const compressedSizeBytes = compressedBuffer.length;

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const hashShort = contentHash.slice(0, 12);
    const fileName = `${datePrefix}_${hashShort}.html.gz`;

    const subDir = path.join(`tier-${tier}`, targetStone);
    const fullDir = path.join(this.baseDir, subDir);

    await fs.mkdir(fullDir, { recursive: true });

    const fullFilePath = path.join(fullDir, fileName);
    await fs.writeFile(fullFilePath, compressedBuffer);

    const relativePath = path.join('data', 'snapshots', subDir, fileName);

    return {
      relativePath,
      rawSizeBytes,
      compressedSizeBytes,
    };
  }

  /**
   * Reads and decompresses an HTML snapshot from disk.
   */
  async readSnapshot(relativePath: string): Promise<string> {
    const fullPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.resolve(process.cwd(), relativePath);

    const compressedBuffer = await fs.readFile(fullPath);
    const decompressed = await gunzipAsync(compressedBuffer);
    return decompressed.toString('utf8');
  }

  /**
   * Checks whether a snapshot file exists on disk.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.isAbsolute(relativePath)
        ? relativePath
        : path.resolve(process.cwd(), relativePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
