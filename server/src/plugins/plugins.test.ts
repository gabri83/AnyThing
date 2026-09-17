import { FIELD_SEPARATOR } from '../osascript';
import {
  EMPTY_SNAPSHOT,
  imageExtension,
  parseSnapshot
} from './apple-music/service';
import { buildTiles as buildMusicTiles } from './apple-music';
import { keystrokeScript, validateMacros } from './macros';
import { cpuUsage, sampleCpu } from './sysmon/backends/cpu';
import { parseVmStat, formatGigabytes } from './sysmon/backends/memory';
import {
  parseLeadingNumber,
  parseOsxCpuTemp,
  parsePowermetrics,
  plausibleTemp,
  probeSensors,
  type SensorBackend
} from './sysmon/backends/sensors';
import { buildTiles as buildSysmonTiles, formatUptime } from './sysmon';

const sep = FIELD_SEPARATOR;
const record = (...fields: Array<string | number>) => fields.join(sep);

describe('apple-music: parseSnapshot', () => {
  it('reads a playing track', () => {
    const snapshot = parseSnapshot(
      record('playing', 'Roundabout', 'Yes', 'Fragile', 508, 61.5, 'ABC123', 'false', 70)
    );

    expect(snapshot).toEqual({
      running: true,
      status: 'playing',
      title: 'Roundabout',
      artist: 'Yes',
      album: 'Fragile',
      duration: 508,
      position: 61.5,
      trackId: 'ABC123',
      shuffle: false,
      volume: 70
    });
  });

  it('treats the bare sentinel as Music not running', () => {
    expect(parseSnapshot('stopped')).toEqual(EMPTY_SNAPSHOT);
  });

  it('keeps a running-but-idle Music distinct from a closed one', () => {
    const snapshot = parseSnapshot(
      record('stopped', '', '', '', 0, 0, '', 'true', 35)
    );
    expect(snapshot.running).toBe(true);
    expect(snapshot.status).toBe('stopped');
    expect(snapshot.shuffle).toBe(true);
    expect(snapshot.volume).toBe(35);
    expect(snapshot.title).toBeNull();
  });

  it('survives a title containing tabs and pipes', () => {
    const nasty = 'a\tb|c';
    const snapshot = parseSnapshot(
      record('playing', nasty, 'Artist', 'Album', 10, 1, 'ID', 'false', 50)
    );
    expect(snapshot.title).toBe(nasty);
    expect(snapshot.artist).toBe('Artist');
  });

  it('clamps a volume outside 0-100 and rounds a fractional duration', () => {
    const snapshot = parseSnapshot(
      record('playing', 'T', 'A', 'B', 100.6, 3, 'ID', 'false', 250)
    );
    expect(snapshot.volume).toBe(100);
    expect(snapshot.duration).toBe(101);
  });

  it('falls back to empty on unparseable output', () => {
    expect(parseSnapshot('')).toEqual(EMPTY_SNAPSHOT);
    expect(parseSnapshot('execution error: Music got an error')).toEqual(EMPTY_SNAPSHOT);
  });
});

describe('apple-music: imageExtension', () => {
  it('detects PNG from its magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(imageExtension(png)).toBe('png');
  });

  it('defaults to jpg for anything else', () => {
    expect(imageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]))).toBe('jpg');
    expect(imageExtension(Buffer.alloc(0))).toBe('jpg');
  });
});

describe('apple-music: buildTiles', () => {
  it('lays out a player, volume controls and shuffle', () => {
    const tiles = buildMusicTiles(
      { ...EMPTY_SNAPSHOT, running: true, status: 'playing', title: 'T', volume: 40 },
      '/files/apple-music/art.jpg'
    );

    const player = tiles[0];
    expect(player.kind).toBe('now-playing');
    if (player.kind === 'now-playing') {
      expect(player.title).toBe('T');
      expect(player.artwork).toBe('/files/apple-music/art.jpg');
      expect(player.actions.seek).toBe('seek');
    }
    expect(tiles.map((tile) => tile.id)).toEqual([
      'player',
      'volume-down',
      'volume',
      'volume-up',
      'shuffle',
      'open'
    ]);
  });

  it('says so on the tile when Music is closed', () => {
    const tiles = buildMusicTiles(EMPTY_SNAPSHOT, null);
    const player = tiles[0];
    if (player.kind !== 'now-playing') throw new Error('expected now-playing');
    expect(player.title).toBe('Music is not running');

    const volume = tiles.find((tile) => tile.id === 'volume');
    if (volume?.kind !== 'gauge') throw new Error('expected gauge');
    // Null, not zero: the volume is unknown, not silent.
    expect(volume.value).toBeNull();
  });

  it('fills one row of the six-column grid below the player', () => {
    const tiles = buildMusicTiles(EMPTY_SNAPSHOT, null);
    const controls = tiles.slice(1).reduce((sum, tile) => sum + (tile.w ?? 1), 0);
    expect(controls).toBe(6);
  });
});

describe('macros: validateMacros', () => {
  it('accepts a well-formed list', () => {
    const { valid, errors } = validateMacros([
      { id: 'a', label: 'Scene 1', type: 'shortcut', value: 'OBS Scene 1' },
      {
        id: 'b',
        label: 'Lock',
        type: 'keystroke',
        value: 'q',
        modifiers: ['command', 'control'],
        confirm: true
      }
    ]);

    expect(errors).toEqual([]);
    expect(valid).toHaveLength(2);
    expect(valid[1].modifiers).toEqual(['command', 'control']);
    expect(valid[1].confirm).toBe(true);
  });

  it('treats a missing list as empty, not an error', () => {
    expect(validateMacros(undefined)).toEqual({ valid: [], errors: [] });
  });

  it('rejects a non-array', () => {
    expect(validateMacros({ id: 'a' }).errors).toEqual(['"macros" must be an array']);
  });

  it('keeps the good entries and reports the bad ones', () => {
    const { valid, errors } = validateMacros([
      { id: 'ok', label: 'Fine', type: 'shell', value: 'true' },
      { label: 'No id', type: 'shell', value: 'true' },
      { id: 'no-label', type: 'shell', value: 'true' },
      { id: 'bad-type', label: 'X', type: 'telepathy', value: 'true' },
      { id: 'no-value', label: 'X', type: 'shell' },
      { id: 'ok', label: 'Dupe', type: 'shell', value: 'true' }
    ]);

    expect(valid.map((macro) => macro.id)).toEqual(['ok']);
    expect(errors).toEqual([
      'macro #2: missing "id"',
      'no-label: missing "label"',
      'bad-type: "type" must be one of shell, applescript, shortcut, keystroke, open',
      'no-value: missing "value"',
      'macro #6: duplicate id "ok"'
    ]);
  });

  it('rejects an unknown modifier by name', () => {
    const { errors } = validateMacros([
      { id: 'a', label: 'A', type: 'keystroke', value: 'q', modifiers: ['meta'] }
    ]);
    expect(errors[0]).toContain('unknown modifier(s) meta');
  });
});

describe('macros: keystrokeScript', () => {
  it('builds a modifier-free keystroke', () => {
    expect(keystrokeScript('a')).toBe(
      'tell application "System Events" to keystroke "a"'
    );
  });

  it('builds a modified keystroke', () => {
    expect(keystrokeScript('q', ['command', 'control'])).toBe(
      'tell application "System Events" to keystroke "q" using {command down, control down}'
    );
  });

  it('escapes a quote so the script cannot be broken out of', () => {
    expect(keystrokeScript('"')).toBe(
      'tell application "System Events" to keystroke "\\""'
    );
  });
});

describe('sysmon: cpu', () => {
  it('computes busy percentage between two samples', () => {
    expect(cpuUsage({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(cpuUsage({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100);
  });

  it('returns null when no time elapsed, rather than dividing by zero', () => {
    expect(cpuUsage({ idle: 10, total: 20 }, { idle: 10, total: 20 })).toBeNull();
  });

  it('clamps to 0-100 even if counters go backwards', () => {
    const usage = cpuUsage({ idle: 0, total: 0 }, { idle: 500, total: 100 });
    expect(usage).toBe(0);
  });

  it('samples real counters that only move forward', () => {
    const first = sampleCpu();
    const second = sampleCpu();
    expect(second.total).toBeGreaterThanOrEqual(first.total);
    expect(second.idle).toBeGreaterThanOrEqual(first.idle);
  });
});

describe('sysmon: parseVmStat', () => {
  const output = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               100.',
    'Pages active:                             200.',
    'Pages inactive:                           300.',
    'Pages wired down:                         400.',
    'Pages occupied by compressor:             500.'
  ].join('\n');

  it('sums active, wired and compressed pages', () => {
    const reading = parseVmStat(output, 64 * 1024 ** 3);
    // (200 + 400 + 500) pages * 16384 bytes
    expect(reading).toEqual({
      used: 1100 * 16384,
      total: 64 * 1024 ** 3,
      precise: true
    });
  });

  it('returns null when the output is not vm_stat', () => {
    expect(parseVmStat('command not found', 1024)).toBeNull();
    expect(parseVmStat('', 1024)).toBeNull();
  });

  it('returns null when page counters are missing', () => {
    expect(
      parseVmStat('Mach Virtual Memory Statistics: (page size of 4096 bytes)', 1024)
    ).toBeNull();
  });

  it('formats bytes as gigabytes', () => {
    expect(formatGigabytes(16 * 1024 ** 3)).toBe('16.0');
  });
});

describe('sysmon: sensor parsers', () => {
  it('reads a leading number from noisy output', () => {
    expect(parseLeadingNumber('56.2')).toBe(56.2);
    expect(parseLeadingNumber('  1183 rpm ')).toBe(1183);
    expect(parseLeadingNumber('no reading')).toBeNull();
  });

  it('rejects the 0.0 that osx-cpu-temp reports on Apple Silicon', () => {
    expect(parseOsxCpuTemp('58.2°C')).toBe(58.2);
    expect(parseOsxCpuTemp('0.0°C')).toBeNull();
  });

  it('pulls die temperature and fan RPM out of powermetrics', () => {
    const output = [
      '**** SMC sensors ****',
      '',
      'CPU die temperature: 45.55 C',
      'Fan: 1183 rpm'
    ].join('\n');
    expect(parsePowermetrics(output)).toEqual({ cpuTempC: 45.55, fanRpm: 1183 });
  });

  it('returns nulls when powermetrics reported neither', () => {
    expect(parsePowermetrics('**** SMC sensors ****')).toEqual({
      cpuTempC: null,
      fanRpm: null
    });
  });

  it('discards an implausible temperature', () => {
    expect(plausibleTemp(52.34)).toBe(52.3);
    expect(plausibleTemp(0)).toBeNull();
    expect(plausibleTemp(900)).toBeNull();
    expect(plausibleTemp(null)).toBeNull();
  });
});

describe('sysmon: probeSensors', () => {
  const backend = (
    id: string,
    present: boolean,
    read: () => Promise<{ cpuTempC: number | null; fanRpm: number | null }>
  ): SensorBackend => ({ id, install: `install ${id}`, present: async () => present, read });

  it('picks the first backend that returns a real reading', async () => {
    const result = await probeSensors([
      backend('absent', false, async () => ({ cpuTempC: 50, fanRpm: 1000 })),
      backend('silent', true, async () => ({ cpuTempC: null, fanRpm: null })),
      backend('works', true, async () => ({ cpuTempC: 44, fanRpm: 900 }))
    ]);

    expect(result.backend?.id).toBe('works');
    // A tool that is installed but reports nothing is the case that motivates
    // probing by reading rather than by presence.
    expect(result.rejected).toEqual(['silent']);
  });

  it('treats a throwing backend as rejected and keeps going', async () => {
    const result = await probeSensors([
      backend('broken', true, async () => {
        throw new Error('segfault');
      }),
      backend('works', true, async () => ({ cpuTempC: 40, fanRpm: null }))
    ]);

    expect(result.backend?.id).toBe('works');
    expect(result.rejected).toEqual(['broken']);
  });

  it('reports no backend when nothing works', async () => {
    const result = await probeSensors([
      backend('a', true, async () => ({ cpuTempC: null, fanRpm: null }))
    ]);
    expect(result.backend).toBeNull();
    expect(result.rejected).toEqual(['a']);
  });

  it('accepts a fan-only backend', async () => {
    const result = await probeSensors([
      backend('fan-only', true, async () => ({ cpuTempC: null, fanRpm: 0 }))
    ]);
    // Zero RPM is a real reading: the fans are idle.
    expect(result.backend?.id).toBe('fan-only');
  });
});

describe('sysmon: tiles', () => {
  const state = {
    cpuPercent: 42.5,
    memory: { used: 8 * 1024 ** 3, total: 16 * 1024 ** 3, precise: true },
    sensors: { cpuTempC: 55, fanRpm: 1200 },
    sensorBackend: 'smctemp',
    sensorsSupported: true
  };

  it('renders readings with units', () => {
    const tiles = buildSysmonTiles(state);
    const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]));

    expect(byId.cpu).toMatchObject({ value: 42.5, unit: '%' });
    expect(byId.memory).toMatchObject({ value: 50, sublabel: '8.0 / 16.0 GB' });
    expect(byId.temp).toMatchObject({ value: 55, warnAt: 85 });
    expect(byId.fan).toMatchObject({ value: 1200, unit: 'RPM' });
    expect(byId.sensors).toMatchObject({ value: 'via smctemp' });
  });

  it('marks memory approximate when it came from the portable path', () => {
    const tiles = buildSysmonTiles({
      ...state,
      memory: { used: 4 * 1024 ** 3, total: 16 * 1024 ** 3, precise: false }
    });
    const memory = tiles.find((tile) => tile.id === 'memory');
    if (memory?.kind !== 'gauge') throw new Error('expected gauge');
    expect(memory.sublabel).toBe('4.0 / 16.0 GB (approx)');
  });

  it('offers an install hint when macOS has no sensor tool', () => {
    const tiles = buildSysmonTiles({
      ...state,
      sensors: { cpuTempC: null, fanRpm: null },
      sensorBackend: null
    });
    const sensors = tiles.find((tile) => tile.id === 'sensors');
    if (sensors?.kind !== 'text') throw new Error('expected text');
    expect(sensors.value).toContain('brew install');

    const temp = tiles.find((tile) => tile.id === 'temp');
    if (temp?.kind !== 'gauge') throw new Error('expected gauge');
    expect(temp.unavailableHint).toBe('No sensor tool');
  });

  it('does not suggest brew on a platform that has no backend at all', () => {
    const tiles = buildSysmonTiles({
      ...state,
      sensors: { cpuTempC: null, fanRpm: null },
      sensorBackend: null,
      sensorsSupported: false
    });
    const sensors = tiles.find((tile) => tile.id === 'sensors');
    if (sensors?.kind !== 'text') throw new Error('expected text');
    expect(sensors.value).toBe('Temperature and fan readings are macOS-only');
  });

  it('formats uptime at day, hour and minute scale', () => {
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatUptime(2 * 86_400 + 5 * 3600)).toBe('2d 5h');
  });
});
