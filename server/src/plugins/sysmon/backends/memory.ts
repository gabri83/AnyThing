import { freemem, totalmem } from 'os';
import { run } from '../../../osascript';

export interface MemoryReading {
  /** Bytes in use, by the definition Activity Monitor shows. */
  used: number;
  /** Bytes installed. */
  total: number;
  /** True when the numbers came from vm_stat rather than os.freemem(). */
  precise: boolean;
}

/**
 * Parse `vm_stat` output into bytes used.
 *
 * `os.freemem()` is misleading on macOS: it reports only the free list, so a
 * Mac using its RAM well looks nearly full. Activity Monitor's "Memory Used"
 * is active + wired + compressed, which is what this computes.
 *
 * Returns null when the output does not look like vm_stat.
 */
export function parseVmStat(output: string, totalBytes: number): MemoryReading | null {
  const pageSizeMatch = output.match(/page size of (\d+) bytes/);
  if (!pageSizeMatch) return null;
  const pageSize = Number.parseInt(pageSizeMatch[1], 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

  const pages = (label: string): number => {
    const match = output.match(
      new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm')
    );
    return match ? Number.parseInt(match[1], 10) : 0;
  };

  const active = pages('Pages active');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');

  if (active === 0 && wired === 0) return null;

  return {
    used: (active + wired + compressed) * pageSize,
    total: totalBytes,
    precise: true
  };
}

/** Read memory usage, preferring vm_stat on macOS and falling back elsewhere. */
export async function readMemory(): Promise<MemoryReading> {
  const total = totalmem();

  if (process.platform === 'darwin') {
    try {
      const parsed = parseVmStat(await run('/usr/bin/vm_stat', [], 3000), total);
      if (parsed) return parsed;
    } catch {
      // Fall through to the portable path.
    }
  }

  return { used: total - freemem(), total, precise: false };
}

export function formatGigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
