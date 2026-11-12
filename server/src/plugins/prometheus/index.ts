import {
  definePlugin,
  rotateDelta,
  type ListItem,
  type PluginApi,
  type Tile,
  type TileColor
} from '@anything/shared';

/**
 * A server at a glance: gauges from Prometheus queries and the alerts that
 * are firing right now.
 *
 * It does nothing until `plugins.prometheus.url` is set. Run the host on the
 * machine being monitored and point it at http://localhost:9090, or at any
 * Prometheus this machine can reach. With `alertmanager` set, alerts come from
 * there, so silences and inhibitions are respected; otherwise they come from
 * Prometheus itself.
 */

export interface MetricConfig {
  label: string;
  /** A PromQL expression that yields one number. Several series: the highest. */
  query: string;
  unit?: string;
  max?: number;
  warnAt?: number;
}

export interface Alert {
  /** Stable across polls, so a new one can be told from one already seen. */
  id: string;
  name: string;
  severity: string;
  summary: string;
  instance: string;
  since: Date | null;
}

export interface Settings {
  url: string;
  alertmanager: string;
  refreshSeconds: number;
  notify: boolean;
  ignoreAlerts: string[];
  metrics: MetricConfig[];
}

export interface State {
  /** One per configured metric, in order; null when it could not be read. */
  values: Array<number | null>;
  alerts: Alert[];
  /** Why the last poll failed, or null. */
  problem: string | null;
  loaded: boolean;
  selected: string | null;
}

/** Sensible for any Linux box running node_exporter. */
export const DEFAULT_METRICS: MetricConfig[] = [
  {
    label: 'CPU',
    query: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))',
    unit: '%',
    max: 100,
    warnAt: 85
  },
  {
    label: 'Memory',
    query: '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
    unit: '%',
    max: 100,
    warnAt: 90
  },
  {
    label: 'Disk',
    query:
      '100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})',
    unit: '%',
    max: 100,
    warnAt: 85
  }
];

const MAX_METRICS = 6;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readSettings(config: Record<string, unknown>): Settings {
  const metrics = Array.isArray(config.metrics)
    ? config.metrics
        .map((entry): MetricConfig | null => {
          const item = (entry ?? {}) as Record<string, unknown>;
          const label = text(item.label);
          const query = text(item.query);
          if (!label || !query) return null;
          return {
            label,
            query,
            unit: text(item.unit) || undefined,
            max: finite(item.max),
            warnAt: finite(item.warnAt)
          };
        })
        .filter((entry): entry is MetricConfig => entry !== null)
        .slice(0, MAX_METRICS)
    : DEFAULT_METRICS;

  const refresh = finite(config.refreshSeconds) ?? 20;
  return {
    url: text(config.url).replace(/\/+$/, ''),
    alertmanager: text(config.alertmanager).replace(/\/+$/, ''),
    refreshSeconds: Math.min(600, Math.max(5, refresh)),
    notify: config.notify !== false,
    ignoreAlerts: Array.isArray(config.ignoreAlerts)
      ? config.ignoreAlerts.filter((name): name is string => typeof name === 'string')
      : ['Watchdog'],
    metrics
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** The value of an instant query: a scalar, or the highest of a vector. */
export function instantValue(body: unknown): number | null {
  const data = (body as { data?: { resultType?: string; result?: unknown } } | null)?.data;
  if (!data) return null;
  const numbers: number[] = [];
  if (data.resultType === 'scalar' && Array.isArray(data.result)) {
    numbers.push(Number(data.result[1]));
  } else if (data.resultType === 'vector' && Array.isArray(data.result)) {
    for (const series of data.result as Array<{ value?: [number, string] }>) {
      numbers.push(Number(series.value?.[1]));
    }
  }
  const usable = numbers.filter((value) => Number.isFinite(value));
  return usable.length > 0 ? Math.max(...usable) : null;
}

type Labels = Record<string, string>;

function toAlert(labels: Labels, annotations: Labels, since: string | undefined, id?: string): Alert {
  const started = since ? new Date(since) : null;
  return {
    id:
      id ??
      Object.keys(labels)
        .sort()
        .map((key) => `${key}=${labels[key]}`)
        .join(','),
    name: labels.alertname ?? 'Alert',
    severity: (labels.severity ?? '').toLowerCase(),
    summary: annotations.summary ?? annotations.description ?? annotations.message ?? '',
    instance: labels.instance ?? labels.job ?? '',
    since: started && !Number.isNaN(started.getTime()) && started.getFullYear() > 1971 ? started : null
  };
}

/** Firing alerts from Prometheus's own /api/v1/alerts. */
export function alertsFromPrometheus(body: unknown): Alert[] {
  const alerts = (body as { data?: { alerts?: unknown } } | null)?.data?.alerts;
  if (!Array.isArray(alerts)) return [];
  return (alerts as Array<{ labels?: Labels; annotations?: Labels; state?: string; activeAt?: string }>)
    .filter((alert) => alert.state === 'firing')
    .map((alert) => toAlert(alert.labels ?? {}, alert.annotations ?? {}, alert.activeAt));
}

/** Alerts from Alertmanager's /api/v2/alerts, already filtered to active ones. */
export function alertsFromAlertmanager(body: unknown): Alert[] {
  if (!Array.isArray(body)) return [];
  return (
    body as Array<{
      labels?: Labels;
      annotations?: Labels;
      startsAt?: string;
      fingerprint?: string;
      status?: { state?: string };
    }>
  )
    .filter((alert) => (alert.status?.state ?? 'active') === 'active')
    .map((alert) => toAlert(alert.labels ?? {}, alert.annotations ?? {}, alert.startsAt, alert.fingerprint));
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, error: 1, warning: 2 };

function severityColor(severity: string): TileColor {
  if (severity === 'critical' || severity === 'error') return 'red';
  if (severity === 'warning') return 'orange';
  return 'yellow';
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0) ||
      a.name.localeCompare(b.name)
  );
}

export function ago(since: Date | null, now: Date): string {
  if (!since) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Build the page for a state. Pure, so the layout is directly testable. */
export function buildTiles(settings: Settings, state: State, now: Date = new Date()): Tile[] {
  const gauges: Tile[] = settings.metrics.map((metric, index) => {
    const value = state.values[index] ?? null;
    return {
      kind: 'gauge',
      id: `metric-${index}`,
      w: 2,
      label: metric.label,
      value: value === null ? null : Math.round(value * 10) / 10,
      max: metric.max ?? 100,
      unit: metric.unit,
      warnAt: metric.warnAt,
      unavailableHint: state.loaded ? 'no data' : 'loading'
    };
  });

  const items: ListItem[] = state.alerts.map((alert) => {
    const chosen = alert.id === state.selected;
    const where = [alert.instance, ago(alert.since, now)].filter(Boolean).join(' · ');
    return {
      id: alert.id,
      title: alert.name,
      subtitle: chosen && alert.summary ? `${where}\n${alert.summary}` : where || alert.summary,
      badge: alert.severity || 'firing',
      badgeColor: severityColor(alert.severity)
    };
  });

  // Three gauges fill a row. The alert list takes what is left of three rows.
  const gaugeRows = Math.ceil(gauges.length / 3);
  return [
    ...gauges,
    {
      kind: 'list',
      id: 'alerts',
      w: 6,
      h: Math.max(1, 3 - gaugeRows),
      label: state.alerts.length > 0 ? `${state.alerts.length} firing` : undefined,
      color: state.problem ? 'red' : undefined,
      items,
      selected: state.selected ?? undefined,
      action: 'select',
      emptyHint: state.problem
        ? `Cannot reach ${host(settings.url)}: ${state.problem}`
        : state.loaded
          ? 'All clear. No alerts are firing.'
          : `Asking ${host(settings.url)}`
    }
  ];
}

function setup(api: PluginApi): void {
  const settings = readSettings(api.config);
  if (!settings.url) {
    throw new Error(
      'not set up: add "prometheus": { "url": "http://localhost:9090" } under plugins in the config'
    );
  }

  const state: State = {
    values: settings.metrics.map(() => null),
    alerts: [],
    problem: null,
    loaded: false,
    selected: null
  };
  /** Alerts already seen, so only a newly firing one interrupts. */
  let known: Set<string> | null = null;

  const render = () => {
    if (!state.selected || !state.alerts.some((alert) => alert.id === state.selected)) {
      state.selected = state.alerts[0]?.id ?? null;
    }
    api.setTiles(buildTiles(settings, state));
  };

  const loadAlerts = async (): Promise<Alert[]> =>
    settings.alertmanager
      ? alertsFromAlertmanager(
          await getJson(
            `${settings.alertmanager}/api/v2/alerts?active=true&silenced=false&inhibited=false`
          )
        )
      : alertsFromPrometheus(await getJson(`${settings.url}/api/v1/alerts`));

  const announce = (alert: Alert) => {
    api.focus();
    void api.prompt(
      {
        source: alert.instance || undefined,
        title: alert.name,
        body: alert.summary || `A ${alert.severity || 'new'} alert is firing.`,
        choices: [{ id: 'ok', label: 'OK', role: 'primary' }]
      },
      { id: `alert-${alert.id}`, timeoutMs: 15 * 60_000 }
    );
  };

  const refresh = async () => {
    const [values, alerts] = await Promise.all([
      Promise.all(
        settings.metrics.map((metric) =>
          getJson(`${settings.url}/api/v1/query?query=${encodeURIComponent(metric.query)}`)
            .then(instantValue)
            .catch(() => null)
        )
      ),
      loadAlerts().then(
        (found) => ({ found, error: null as string | null }),
        (error: Error) => ({ found: null, error: error.message })
      )
    ]);

    state.values = values;
    state.loaded = true;
    state.problem = alerts.error;

    if (alerts.found) {
      const current = sortAlerts(
        alerts.found.filter((alert) => !settings.ignoreAlerts.includes(alert.name))
      );
      const ids = new Set(current.map((alert) => alert.id));
      if (known) {
        for (const id of known) {
          if (!ids.has(id)) api.dismissPrompt(`alert-${id}`);
        }
        if (settings.notify) {
          for (const alert of current) {
            if (!known.has(alert.id)) announce(alert);
          }
        }
      }
      known = ids;
      state.alerts = current;
    }
    // On a failed poll the alerts already on screen stay, under a red note.
    render();
  };

  api.onAction('select', (payload) => {
    const id = (payload as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && state.alerts.some((alert) => alert.id === id)) {
      state.selected = id;
      render();
    }
  });

  api.onAction('move', (payload) => {
    const delta = rotateDelta(payload);
    if (delta === null || state.alerts.length === 0) return;
    const index = Math.max(0, state.alerts.findIndex((alert) => alert.id === state.selected));
    state.selected =
      state.alerts[Math.min(state.alerts.length - 1, Math.max(0, index + delta))].id;
    render();
  });

  api.onAction('refresh', refresh);
  api.setControls({ rotate: 'move', presets: ['refresh'] });

  render();
  void refresh();
  api.every(settings.refreshSeconds * 1000, refresh);
  // "12 min" on a firing alert should keep counting between polls.
  api.every(60_000, render);
}

export default definePlugin({
  manifest: {
    id: 'prometheus',
    name: 'Server',
    version: '1.0.0',
    description: 'Gauges from Prometheus queries and the alerts firing right now',
    icon: '🖥',
    defaultConfig: {
      url: '',
      alertmanager: '',
      refreshSeconds: 20,
      notify: true,
      ignoreAlerts: ['Watchdog']
    }
  },
  setup
});
