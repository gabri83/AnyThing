import { useState } from 'react';
import { api, type SettingsPayload } from './client';

export interface ServerPanelProps {
  config: SettingsPayload['config'];
  paths: SettingsPayload['paths'];
  deviceUrl: string;
  onChange: (config: SettingsPayload['config']) => void;
}

export function ServerPanel({ config, paths, deviceUrl, onChange }: ServerPanelProps) {
  const [rotated, setRotated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rotate = async () => {
    setError(null);
    try {
      const result = await api.rotateToken();
      // Store it here too, or this page loses its own access on the next load
      // when opened from somewhere other than the Mac.
      try {
        window.localStorage.setItem('anything.token', result.token);
      } catch {
        // Storage blocked; the URL below is still the way in.
      }
      setRotated(result.deviceUrl);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Host</h2>
          <p className="panel-sub">Where the host listens, and who may reach it.</p>
        </div>
      </header>

      <div className="field-row">
        <label className="field">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={config.server.port}
            onChange={(event) =>
              onChange({
                ...config,
                server: { ...config.server, port: Number(event.target.value) }
              })
            }
          />
        </label>

        <label className="field field-grow">
          <span>Listen address</span>
          <select
            value={config.server.host}
            onChange={(event) =>
              onChange({
                ...config,
                server: { ...config.server, host: event.target.value }
              })
            }
          >
            <option value="0.0.0.0">All interfaces — the device can reach it</option>
            <option value="127.0.0.1">This Mac only</option>
          </select>
        </label>
      </div>

      <p className="panel-note">
        Changing either needs a host restart; everything else applies straight away.
      </p>

      <h3>Access</h3>

      <label className="check">
        <input
          type="checkbox"
          checked={config.auth.enabled}
          onChange={(event) =>
            onChange({
              ...config,
              auth: { ...config.auth, enabled: event.target.checked }
            })
          }
        />
        Require a token
      </label>

      {!config.auth.enabled && (
        <p className="warn">
          With this off, anyone who can reach the port can run your macros — and
          macros run shell commands.
        </p>
      )}

      <label className="check">
        <input
          type="checkbox"
          checked={config.auth.allowRemoteConfig}
          onChange={(event) =>
            onChange({
              ...config,
              auth: { ...config.auth, allowRemoteConfig: event.target.checked }
            })
          }
        />
        Allow editing these settings from other machines
      </label>

      {config.auth.allowRemoteConfig && (
        <p className="warn">
          Editing macros means writing commands this Mac will run. Leave this off
          unless you need to change settings from the device itself.
        </p>
      )}

      <div className="row-actions">
        <button type="button" className="btn" onClick={rotate}>
          Issue a new token
        </button>
        <span className="panel-note">Devices will need the new URL.</span>
      </div>

      {rotated && (
        <p className="test-result">
          New token issued. Open this on the device: <code>{rotated}</code>
        </p>
      )}
      {error && <p className="field-error">{error}</p>}

      <h3>Device URL</h3>
      <p className="url-line">
        <code>{deviceUrl}</code>
      </p>

      <h3>Files</h3>
      <dl className="paths">
        <dt>Config</dt>
        <dd>
          <code>{paths.config}</code>
        </dd>
        <dt>Plugins</dt>
        <dd>
          <code>{paths.plugins}</code>
        </dd>
      </dl>
    </section>
  );
}
