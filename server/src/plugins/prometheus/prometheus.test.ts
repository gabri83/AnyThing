import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { GaugeTile, ListTile } from '@anything/shared';
import { DEFAULT_CONFIG } from '../../config';
import { PluginHost } from '../../host';
import prometheus, {
  ago,
  alertsFromAlertmanager,
  alertsFromPrometheus,
  buildTiles,
  instantValue,
  readSettings,
  sortAlerts,
  type State
} from './index';

const vector = (...values: string[]) => ({
  status: 'success',
  data: { resultType: 'vector', result: values.map((value) => ({ metric: {}, value: [1, value] })) }
});

const firing = (name: string, severity: string, extra: Record<string, string> = {}) => ({
  labels: { alertname: name, severity, instance: 'mini:9100', ...extra },
  annotations: { summary: `${name} summary` },
  state: 'firing',
  activeAt: '2026-11-12T10:00:00Z'
});

describe('reading Prometheus answers', () => {
  it('takes a scalar, or the highest series of a vector', () => {
    expect(instantValue(vector('41.5'))).toBe(41.5);
    expect(instantValue(vector('12', '73.2', 'NaN'))).toBe(73.2);
    expect(instantValue({ data: { resultType: 'scalar', result: [1, '7'] } })).toBe(7);
    expect(instantValue(vector())).toBeNull();
    expect(instantValue({ status: 'error' })).toBeNull();
  });

  it('keeps only firing alerts and gives each a stable id', () => {
    const alerts = alertsFromPrometheus({
      data: { alerts: [firing('DiskSpaceLow', 'warning'), { ...firing('Soon', 'warning'), state: 'pending' }] }
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      name: 'DiskSpaceLow',
      severity: 'warning',
      summary: 'DiskSpaceLow summary',
      instance: 'mini:9100'
    });
    expect(alerts[0].id).toBe('alertname=DiskSpaceLow,instance=mini:9100,severity=warning');
  });

  it('reads Alertmanager alerts by fingerprint and drops suppressed ones', () => {
    const alerts = alertsFromAlertmanager([
      { labels: { alertname: 'A' }, annotations: {}, fingerprint: 'f1', startsAt: '2026-11-12T10:00:00Z', status: { state: 'active' } },
      { labels: { alertname: 'B' }, fingerprint: 'f2', status: { state: 'suppressed' } }
    ]);
    expect(alerts.map((alert) => alert.id)).toEqual(['f1']);
  });

  it('puts critical first, then the most recent', () => {
    const [a, b, c] = alertsFromPrometheus({
      data: {
        alerts: [
          firing('Warn', 'warning'),
          { ...firing('Crit', 'critical'), activeAt: '2026-11-12T09:00:00Z' },
          { ...firing('NewWarn', 'warning'), activeAt: '2026-11-12T11:00:00Z' }
        ]
      }
    });
    expect(sortAlerts([a, b, c]).map((alert) => alert.name)).toEqual(['Crit', 'NewWarn', 'Warn']);
  });

  it('says how long ago in words that fit a badge', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(ago(new Date('2026-11-12T11:48:00Z'), now)).toBe('12 min');
    expect(ago(new Date('2026-11-12T07:00:00Z'), now)).toBe('5 h');
    expect(ago(new Date('2026-11-08T12:00:00Z'), now)).toBe('4 d');
    expect(ago(null, now)).toBe('');
  });
});

describe('settings and layout', () => {
  it('has node_exporter defaults and ignores the always-firing Watchdog', () => {
    const settings = readSettings({ url: 'http://localhost:9090/' });
    expect(settings.url).toBe('http://localhost:9090');
    expect(settings.metrics.map((metric) => metric.label)).toEqual(['CPU', 'Memory', 'Disk']);
    expect(settings.ignoreAlerts).toEqual(['Watchdog']);
    expect(settings.refreshSeconds).toBe(20);
  });

  it('drops malformed metrics and caps how many there are', () => {
    const metrics = [
      { label: 'Temp', query: 'max(node_hwmon_temp_celsius)', unit: '°C', warnAt: 80 },
      { label: 'no query' },
      'nonsense',
      ...Array.from({ length: 9 }, (_, index) => ({ label: `m${index}`, query: 'up' }))
    ];
    const settings = readSettings({ url: 'x', metrics, refreshSeconds: 1 });
    expect(settings.metrics).toHaveLength(6);
    expect(settings.metrics[0]).toMatchObject({ label: 'Temp', unit: '°C', warnAt: 80 });
    expect(settings.refreshSeconds).toBe(5);
  });

  const state = (over: Partial<State> = {}): State => ({
    values: [41.26, null, 12],
    alerts: [],
    problem: null,
    loaded: true,
    selected: null,
    ...over
  });

  it('lays out a row of gauges over the alert list', () => {
    const tiles = buildTiles(readSettings({ url: 'http://mini:9090' }), state());
    expect(tiles.map((tile) => tile.kind)).toEqual(['gauge', 'gauge', 'gauge', 'list']);
    expect((tiles[0] as GaugeTile).value).toBe(41.3);
    expect((tiles[1] as GaugeTile).value).toBeNull();
    const list = tiles[3] as ListTile;
    expect(list).toMatchObject({ w: 6, h: 2, emptyHint: 'All clear. No alerts are firing.' });
  });

  it('shows alerts with severity, and says so when Prometheus is unreachable', () => {
    const settings = readSettings({ url: 'http://mini:9090' });
    const alerts = alertsFromPrometheus({ data: { alerts: [firing('CpuTempCritical', 'critical')] } });
    const list = buildTiles(
      settings,
      state({ alerts, selected: alerts[0].id }),
      new Date('2026-11-12T10:12:00Z')
    )[3] as ListTile;
    expect(list.label).toBe('1 firing');
    expect(list.items[0]).toMatchObject({
      title: 'CpuTempCritical',
      badge: 'critical',
      badgeColor: 'red',
      subtitle: 'mini:9100 · 12 min\nCpuTempCritical summary'
    });

    const down = buildTiles(settings, state({ problem: 'fetch failed' }))[3] as ListTile;
    expect(down.emptyHint).toBe('Cannot reach mini:9090: fetch failed');
    expect(down.color).toBe('red');
  });
});

describe('the plugin against a Prometheus', () => {
  let server: Server;
  let alerts: unknown[];
  let host: PluginHost;

  /** Wait for the plugin's poll to land rather than guessing how long it takes. */
  const until = async (ready: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !ready(); attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  };
  const alertTitles = () =>
    ((host.tilesFor('prometheus')?.[3] as ListTile | undefined)?.items ?? []).map((item) => item.title);

  beforeEach(async () => {
    alerts = [firing('Watchdog', 'none'), firing('DiskSpaceLow', 'warning')];
    server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/api/v1/query')) response.end(JSON.stringify(vector('50')));
      else if (request.url === '/api/v1/alerts') response.end(JSON.stringify({ data: { alerts } }));
      else response.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    host = new PluginHost({
      ...DEFAULT_CONFIG,
      plugins: { prometheus: { url: `http://127.0.0.1:${port}` } }
    });
  });

  afterEach(async () => {
    await host.teardown();
    await new Promise((resolve) => server.close(resolve));
  });

  it('stays out of the way until it is given a URL', async () => {
    const unset = new PluginHost({ ...DEFAULT_CONFIG, plugins: {} });
    await expect(unset.register(prometheus)).rejects.toThrow(/not set up/);
    expect(unset.has('prometheus')).toBe(false);
  });

  it('shows gauges and firing alerts, and interrupts only for a new one', async () => {
    await host.register(prometheus);
    await until(() => alertTitles().length === 1);

    const tiles = host.tilesFor('prometheus') ?? [];
    expect((tiles[0] as GaugeTile).value).toBe(50);
    expect((tiles[3] as ListTile).items.map((item) => item.title)).toEqual(['DiskSpaceLow']);
    // Alerts that were already firing when the host started are not announced.
    expect(host.pendingPrompts()).toEqual([]);

    alerts.push(firing('CpuTempCritical', 'critical'));
    await host.invoke('prometheus', 'refresh');
    await until(() => host.pendingPrompts().length === 1);

    expect(host.pendingPrompts().map((prompt) => prompt.title)).toEqual(['CpuTempCritical']);
    expect((host.tilesFor('prometheus')?.[3] as ListTile).items[0].title).toBe('CpuTempCritical');

    // When it stops firing, the prompt is withdrawn rather than left on screen.
    alerts.pop();
    await host.invoke('prometheus', 'refresh');
    await until(() => host.pendingPrompts().length === 0);
    expect(host.pendingPrompts()).toEqual([]);
  });
});
