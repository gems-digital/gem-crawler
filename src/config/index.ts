import fs from 'node:fs/promises';
import path from 'node:path';
import type { RegisteredSource, SeedStone } from '../types/index.js';

export async function loadSourcesConfig(
  filePath: string = path.resolve(process.cwd(), 'config', 'sources.json')
): Promise<RegisteredSource[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error(`Invalid format in ${filePath}: expected an array of sources`);
    }
    return data as RegisteredSource[];
  } catch (err) {
    console.error(`[Config] Failed to load sources from ${filePath}:`, err);
    return [];
  }
}

export async function loadSeedStonesConfig(
  filePath: string = path.resolve(process.cwd(), 'config', 'seed-stones.json')
): Promise<SeedStone[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error(`Invalid format in ${filePath}: expected an array of seed stones`);
    }
    return data as SeedStone[];
  } catch (err) {
    console.error(`[Config] Failed to load seed stones from ${filePath}:`, err);
    return [];
  }
}
