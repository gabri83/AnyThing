import { useState } from 'react';
import { api, type PluginSummary } from './client';

export interface PluginsPanelProps {
  plugins: PluginSummary[];
  pluginDir: string;
  /** Toggle a plugin's enabled flag in the draft config. */
  onToggle: (id: string, enabled: boolean) => void;
  onReloaded: (loaded: string[]) => void;
}

export function PluginsPanel({
  plugins,
  pluginDir,
  onToggle,
  onReloaded
}: PluginsPanelProps) {
  const [reloading, setReloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = async () => {
    setReloading(true);
    setMessage(null);
    try {
      const { loaded } = await api.reloadPlugins();
      onReloaded(loaded);
      setMessage(
        loaded.length > 0 ? `Loaded: ${loaded.join(', ')}` : 'No plugins loaded'
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setReloading(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Plugins</h2>
          <p className="panel-sub">
            Drop a folder with an <code>index.js</code> into{' '}
            <code>{pluginDir}</code>, then rescan.
          </p>
        </div>
        <button type="button" className="btn" disabled={reloading} onClick={reload}>
          {reloading ? 'Rescanning...' : 'Rescan folder'}
        </button>
      </header>

      <ul className="plugin-list">
        {plugins.map((plugin) => (
          <li key={plugin.id} className="plugin" data-unsupported={!plugin.supported || undefined}>
            <span className="plugin-icon">{plugin.icon ?? '●'}</span>

            <div className="plugin-body">
              <div className="plugin-title">
                {plugin.name}
                <span className="plugin-version">v{plugin.version}</span>
                <span className="plugin-origin">{plugin.origin}</span>
              </div>
              {plugin.description && (
                <p className="plugin-desc">{plugin.description}</p>
              )}
              {plugin.note && <p className="plugin-note">{plugin.note}</p>}
            </div>

            <label className="switch" title={plugin.enabled ? 'Enabled' : 'Disabled'}>
              <input
                type="checkbox"
                checked={plugin.enabled}
                onChange={(event) => onToggle(plugin.id, event.target.checked)}
              />
              <span />
            </label>
          </li>
        ))}
      </ul>

      {message && <p className="test-result">{message}</p>}

      <p className="panel-note">
        A plugin marked unsupported stays listed but is skipped at load time.
        Rescan picks up a newly added folder without restarting the host.
      </p>
    </section>
  );
}
