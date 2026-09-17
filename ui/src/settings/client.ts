import type { InputConfig } from '@anything/shared';

/** Shape the host returns from GET /api/config. The token is redacted. */
export interface SettingsPayload {
  config: {
    server: { host: string; port: number };
    auth: { enabled: boolean; token: string; allowRemoteConfig: boolean };
    input: InputConfig;
    plugins: Record<string, Record<string, unknown> & { enabled?: boolean }>;
  };
  paths: { config: string; plugins: string };
  deviceUrl: string;
  platform: string;
  arch: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  origin: 'built-in' | 'user';
  enabled: boolean;
  supported: boolean;
  note?: string;
}

const TOKEN_KEY = 'anything.token';

function authHeaders(): Record<string, string> {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return token ? { 'x-anything-token': token } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined)
    }
  });

  if (!response.ok) {
    // The host explains refusals in the body; surfacing that beats "403".
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail ?? `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<SettingsPayload>('/config'),

  saveSettings: (config: SettingsPayload['config']) =>
    request<{ restartRequired: boolean }>('/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  getPlugins: () =>
    request<{ plugins: PluginSummary[]; pluginDir: string }>('/plugins'),

  reloadPlugins: () =>
    request<{ loaded: string[] }>('/plugins/reload', { method: 'POST' }),

  rotateToken: () =>
    request<{ token: string; deviceUrl: string }>('/rotate-token', {
      method: 'POST'
    }),

  invoke: (plugin: string, action: string) =>
    request<{ ok: true }>(`/invoke/${encodeURIComponent(plugin)}/${encodeURIComponent(action)}`, {
      method: 'POST'
    })
};
