import { uptime } from 'os';
import { definePlugin, type PluginApi, type Tile } from '@anything/shared';
import { cpuUsage, loadSummary, sampleCpu, type CpuSample } from './backends/cpu';
import { formatGigabytes, readMemory, type MemoryReading } from './backends/memory';
import {
  NO_SENSORS,
  installHint,
  probeSensors,
  type SensorBackend,
  type SensorReading
} from './backends/sensors';

export interface SysmonState {
  cpuPercent: number | null;
  memory: MemoryReading | null;
  sensors: SensorReading;
  /** Id of the sensor backend in use, or null when none was found. */
  sensorBackend: string | null;
  /** False on platforms with no sensor backend at all, so the hint stays honest. */
  sensorsSupported: boolean;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Build the tile set for a state. Pure, so the layout is directly testable. */
export function buildTiles(state: SysmonState): Tile[] {
  const { load1, cores } = loadSummary();
  const memory = state.memory;
  const memoryPercent = memory
    ? Math.round((memory.used / memory.total) * 1000) / 10
    : null;

  const sensorsMissing = state.sensorBackend === null;
  const missingHint = state.sensorsSupported ? 'No sensor tool' : 'macOS only';

  return [
    {
      kind: 'gauge',
      id: 'cpu',
      w: 2,
      label: 'CPU',
      value: state.cpuPercent,
      max: 100,
      unit: '%',
      warnAt: 85,
      sublabel: `load ${load1.toFixed(2)} across ${cores} cores`
    },
    {
      kind: 'gauge',
      id: 'memory',
      w: 2,
      label: 'Memory',
      value: memoryPercent,
      max: 100,
      unit: '%',
      warnAt: 90,
      sublabel: memory
        ? `${formatGigabytes(memory.used)} / ${formatGigabytes(memory.total)} GB` +
          (memory.precise ? '' : ' (approx)')
        : undefined
    },
    {
      kind: 'gauge',
      id: 'temp',
      label: 'CPU temp',
      value: state.sensors.cpuTempC,
      max: 110,
      unit: '°C',
      warnAt: 85,
      unavailableHint: sensorsMissing ? missingHint : 'Not reported'
    },
    {
      kind: 'gauge',
      id: 'fan',
      label: 'Fan',
      value: state.sensors.fanRpm,
      max: 6000,
      unit: 'RPM',
      unavailableHint: sensorsMissing ? missingHint : 'Fanless or idle'
    },
    {
      kind: 'text',
      id: 'uptime',
      w: 3,
      label: 'Uptime',
      value: formatUptime(uptime())
    },
    {
      kind: 'text',
      id: 'sensors',
      w: 3,
      color: sensorsMissing ? 'orange' : 'neutral',
      label: 'Sensors',
      value: !sensorsMissing
        ? `via ${state.sensorBackend}`
        : state.sensorsSupported
          ? `Temp and fans need a helper: ${installHint()}`
          : 'Temperature and fan readings are macOS-only'
    }
  ];
}

interface Settings {
  pollMs: number;
  /** Set false to skip sensor probing entirely. */
  sensors: boolean;
}

function readSettings(config: Record<string, unknown>): Settings {
  const pollMs = Number(config.pollMs);
  return {
    pollMs: Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000,
    sensors: config.sensors !== false
  };
}

export default definePlugin({
  manifest: {
    id: 'sysmon',
    name: 'System',
    version: '1.0.0',
    description: 'CPU, memory, temperature and fan readings for the host',
    icon: '◴',
    defaultConfig: { pollMs: 2000, sensors: true }
  },

  async setup(api: PluginApi) {
    const settings = readSettings(api.config);

    let backend: SensorBackend | null = null;
    if (settings.sensors && process.platform === 'darwin') {
      const probe = await probeSensors();
      backend = probe.backend;
      if (backend) {
        api.log(`reading temperature and fans via ${backend.id}`);
      } else {
        // Say this once at startup rather than on every poll. The same text
        // reaches the screen through the "Sensors" tile.
        api.log(
          `no working sensor tool found${
            probe.rejected.length > 0 ? ` (tried ${probe.rejected.join(', ')})` : ''
          }; CPU and memory still work. Install one: ${installHint()}`
        );
      }
    } else if (settings.sensors) {
      api.log(
        `temperature and fan readings are macOS-only; this host is ${api.platform}`
      );
    }

    const state: SysmonState = {
      cpuPercent: null,
      memory: null,
      sensors: { ...NO_SENSORS },
      sensorBackend: backend?.id ?? null,
      sensorsSupported: process.platform === 'darwin'
    };

    let previousCpu: CpuSample = sampleCpu();

    api.every(settings.pollMs, async () => {
      const currentCpu = sampleCpu();
      const usage = cpuUsage(previousCpu, currentCpu);
      if (usage !== null) state.cpuPercent = usage;
      previousCpu = currentCpu;

      state.memory = await readMemory();

      if (backend) {
        try {
          state.sensors = await backend.read();
        } catch (error) {
          api.warn(`${backend.id} read failed: ${(error as Error).message}`);
          state.sensors = { ...NO_SENSORS };
        }
      }

      api.setTiles(buildTiles(state));
    });
  }
});
