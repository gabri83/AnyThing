import { commandExists, run } from '../../../osascript';

export interface SensorReading {
  /** Degrees Celsius, or null when this backend cannot read temperature. */
  cpuTempC: number | null;
  /** Fan RPM, or null when unreadable. Zero is a valid reading: fans idle. */
  fanRpm: number | null;
}

export const NO_SENSORS: SensorReading = { cpuTempC: null, fanRpm: null };

export interface SensorBackend {
  id: string;
  /** Shown to the user when no backend is available. */
  install: string;
  /** True when the tool is present. Cheap; does not read sensors. */
  present(): Promise<boolean>;
  read(): Promise<SensorReading>;
}

// ---------------------------------------------------------------------------
// Parsers, kept pure and exported so they can be tested without the tools
// installed. Every one of these formats differs, which is most of the reason
// a probe chain exists at all.
// ---------------------------------------------------------------------------

/** First float anywhere in the string, or null. */
export function parseLeadingNumber(output: string): number | null {
  const match = output.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** `osx-cpu-temp` prints e.g. "58.2°C". */
export function parseOsxCpuTemp(output: string): number | null {
  const value = parseLeadingNumber(output);
  // The tool reports 0.0 on Apple Silicon, where it cannot read the SMC.
  return value !== null && value > 0 ? value : null;
}

/**
 * `sudo powermetrics --samplers smc` prints lines like:
 *   CPU die temperature: 45.55 C
 *   Fan: 1183 rpm
 */
export function parsePowermetrics(output: string): SensorReading {
  const temp = output.match(/CPU die temperature:\s*(-?\d+(?:\.\d+)?)/);
  const fan = output.match(/Fan:\s*(\d+(?:\.\d+)?)/);
  return {
    cpuTempC: temp ? Number.parseFloat(temp[1]) : null,
    fanRpm: fan ? Math.round(Number.parseFloat(fan[1])) : null
  };
}

/** A temperature only counts if it is in a plausible range for silicon. */
export function plausibleTemp(value: number | null): number | null {
  if (value === null) return null;
  return value > 0 && value < 150 ? Math.round(value * 10) / 10 : null;
}

// ---------------------------------------------------------------------------
// Backends, in probe order: broadest hardware support first.
// ---------------------------------------------------------------------------

/** Works on both Apple Silicon and Intel. `brew install narugit/tap/smctemp`. */
const smctemp: SensorBackend = {
  id: 'smctemp',
  install: 'brew install narugit/tap/smctemp',
  present: () => commandExists('smctemp'),
  async read() {
    const [temp, fan] = await Promise.all([
      run('smctemp', ['-c'], 4000).catch(() => ''),
      run('smctemp', ['-f'], 4000).catch(() => '')
    ]);
    return {
      cpuTempC: plausibleTemp(parseLeadingNumber(temp)),
      fanRpm: parseLeadingNumber(fan) !== null ? Math.round(parseLeadingNumber(fan)!) : null
    };
  }
};

/** Intel Macs. `gem install iStats`. */
const istats: SensorBackend = {
  id: 'istats',
  install: 'gem install iStats',
  present: () => commandExists('istats'),
  async read() {
    const [temp, fan] = await Promise.all([
      run('istats', ['cpu', 'temp', '--value-only'], 4000).catch(() => ''),
      run('istats', ['fan', 'speed', '--value-only'], 4000).catch(() => '')
    ]);
    return {
      cpuTempC: plausibleTemp(parseLeadingNumber(temp)),
      fanRpm: parseLeadingNumber(fan) !== null ? Math.round(parseLeadingNumber(fan)!) : null
    };
  }
};

/** Intel Macs, temperature only. `brew install osx-cpu-temp`. */
const osxCpuTemp: SensorBackend = {
  id: 'osx-cpu-temp',
  install: 'brew install osx-cpu-temp',
  present: () => commandExists('osx-cpu-temp'),
  async read() {
    const temp = await run('osx-cpu-temp', [], 4000).catch(() => '');
    return { cpuTempC: plausibleTemp(parseOsxCpuTemp(temp)), fanRpm: null };
  }
};

/**
 * Built into macOS but requires root. Only usable when the user has added a
 * NOPASSWD sudoers rule, so this probes with `sudo -n` and is tried last —
 * without the rule it fails instantly rather than prompting.
 */
const powermetricsSudo: SensorBackend = {
  id: 'powermetrics-sudo',
  install:
    'add a NOPASSWD sudoers rule for /usr/bin/powermetrics (see docs/SYSMON.md)',
  async present() {
    if (process.platform !== 'darwin') return false;
    try {
      await run('/usr/bin/sudo', ['-n', '/usr/bin/true'], 2000);
      return true;
    } catch {
      return false;
    }
  },
  async read() {
    const output = await run(
      '/usr/bin/sudo',
      ['-n', '/usr/bin/powermetrics', '-n', '1', '-i', '200', '--samplers', 'smc'],
      8000
    ).catch(() => '');
    const reading = parsePowermetrics(output);
    return { cpuTempC: plausibleTemp(reading.cpuTempC), fanRpm: reading.fanRpm };
  }
};

export const sensorBackends: SensorBackend[] = [
  smctemp,
  istats,
  osxCpuTemp,
  powermetricsSudo
];

export interface ProbeResult {
  /** The backend that produced a reading, or null when none did. */
  backend: SensorBackend | null;
  /** Ids that were present but produced nothing, for the log. */
  rejected: string[];
}

/**
 * Find a sensor backend that actually returns a value on this machine.
 *
 * Presence on PATH is not enough: `osx-cpu-temp` installs fine on Apple
 * Silicon and reports 0.0 forever. So each candidate is made to produce a real
 * reading before it is accepted.
 */
export async function probeSensors(
  candidates: SensorBackend[] = sensorBackends
): Promise<ProbeResult> {
  const rejected: string[] = [];

  for (const backend of candidates) {
    if (!(await backend.present())) continue;
    try {
      const reading = await backend.read();
      if (reading.cpuTempC !== null || reading.fanRpm !== null) {
        return { backend, rejected };
      }
      rejected.push(backend.id);
    } catch {
      rejected.push(backend.id);
    }
  }

  return { backend: null, rejected };
}

/** Install hints for every backend, shown when none is available. */
export function installHint(): string {
  return sensorBackends
    .filter((backend) => backend.id !== 'powermetrics-sudo')
    .map((backend) => backend.install)
    .join(' or ');
}
