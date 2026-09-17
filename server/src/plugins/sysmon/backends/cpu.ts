import { cpus, loadavg } from 'os';

export interface CpuSample {
  idle: number;
  total: number;
}

/**
 * Aggregate CPU time across all cores.
 *
 * Utilization has to be a delta between two samples — the counters are
 * cumulative since boot, so a single reading only ever describes the whole
 * uptime. This is why the plugin keeps the previous sample around instead of
 * reporting `loadavg`, which is a queue length rather than a percentage.
 */
export function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

/**
 * Busy percentage between two samples, 0-100. Returns null when the samples
 * are identical (no elapsed time), rather than dividing by zero.
 */
export function cpuUsage(previous: CpuSample, current: CpuSample): number | null {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return null;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.min(100, Math.max(0, Math.round(usage * 10) / 10));
}

/** One-minute load average, and the core count it should be read against. */
export function loadSummary(): { load1: number; cores: number } {
  return { load1: Math.round(loadavg()[0] * 100) / 100, cores: cpus().length };
}
