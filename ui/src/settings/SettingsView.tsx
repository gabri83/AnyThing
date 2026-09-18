import { useCallback, useEffect, useMemo, useState } from 'react';
import { ControlsPanel } from './ControlsPanel';
import { MacrosEditor, validateDrafts, type MacroDraft } from './MacrosEditor';
import { PluginsPanel } from './PluginsPanel';
import { ServerPanel } from './ServerPanel';
import { api, type PluginSummary, type SettingsPayload } from './client';
import './settings.css';

type Tab = 'macros' | 'plugins' | 'controls' | 'host';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'macros', label: 'Macros' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'controls', label: 'Dial & buttons' },
  { id: 'host', label: 'Host' }
];

/** Read the macros plugin's list out of the config blob. */
function readMacros(config: SettingsPayload['config']): MacroDraft[] {
  const raw = config.plugins?.macros?.macros;
  return Array.isArray(raw) ? (raw as MacroDraft[]) : [];
}

export interface SettingsViewProps {
  onClose: () => void;
}

/**
 * The settings surface, served by the host and meant for a browser on the Mac.
 *
 * Edits are held locally and written on Save rather than as you type: these
 * fields describe shell commands that will run on the machine, and a
 * half-finished one should not reach the device.
 */
export function SettingsView({ onClose }: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>('macros');
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<SettingsPayload['config'] | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginDir, setPluginDir] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [settings, pluginList] = await Promise.all([
        api.getSettings(),
        api.getPlugins()
      ]);
      setPayload(settings);
      setDraft(settings.config);
      setPlugins(pluginList.plugins);
      setPluginDir(pluginList.pluginDir);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const macros = useMemo(() => (draft ? readMacros(draft) : []), [draft]);
  const macroErrors = useMemo(() => validateDrafts(macros), [macros]);
  const dirty = useMemo(
    () => Boolean(draft && payload && JSON.stringify(draft) !== JSON.stringify(payload.config)),
    [draft, payload]
  );

  const setMacros = (next: MacroDraft[]) => {
    if (!draft) return;
    setDraft({
      ...draft,
      plugins: {
        ...draft.plugins,
        macros: { ...(draft.plugins.macros ?? {}), macros: next }
      }
    });
  };

  const togglePlugin = (id: string, enabled: boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      plugins: { ...draft.plugins, [id]: { ...(draft.plugins[id] ?? {}), enabled } }
    });
    setPlugins((current) =>
      current.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin))
    );
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const result = await api.saveSettings(draft);
      setSaveMessage(
        result.restartRequired
          ? 'Saved. The port or address changed, so restart the host for that part.'
          : 'Saved. The device has it already.'
      );
      // Re-read rather than trusting the draft: the host normalizes, and the
      // page should show what it actually stored.
      await load();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="settings">
        <div className="settings-error">
          <h1>Cannot reach the host settings</h1>
          <p>{loadError}</p>
          <p className="panel-note">
            Settings are editable from the Mac running the host. From another
            machine, set <code>auth.allowRemoteConfig</code> in the config file.
          </p>
          <button type="button" className="btn" onClick={onClose}>
            Back to the controller
          </button>
        </div>
      </div>
    );
  }

  if (!draft || !payload) {
    return (
      <div className="settings">
        <p className="panel-note">Loading settings...</p>
      </div>
    );
  }

  const macrosLoaded = plugins.some(
    (plugin) => plugin.id === 'macros' && plugin.enabled && plugin.supported
  );
  const blocked = Object.keys(macroErrors).length > 0;

  return (
    <div className="settings">
      <header className="settings-bar">
        <h1>AnyThing settings</h1>
        <nav className="settings-tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="settings-actions">
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving || blocked}
            title={blocked ? 'Fix the highlighted macros first' : undefined}
            onClick={save}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {(saveMessage || saveError) && (
        <p className={saveError ? 'field-error' : 'test-result'}>
          {saveError ?? saveMessage}
        </p>
      )}

      <div className="settings-body">
        {tab === 'macros' && (
          <MacrosEditor macros={macros} onChange={setMacros} live={macrosLoaded} />
        )}
        {tab === 'plugins' && (
          <PluginsPanel
            plugins={plugins}
            pluginDir={pluginDir}
            onToggle={togglePlugin}
            onReloaded={() => void load()}
          />
        )}
        {tab === 'controls' && (
          <ControlsPanel
            input={draft.input}
            onChange={(input) => setDraft({ ...draft, input })}
          />
        )}
        {tab === 'host' && (
          <ServerPanel
            config={draft}
            paths={payload.paths}
            deviceUrl={payload.deviceUrl}
            onChange={setDraft}
          />
        )}
      </div>
    </div>
  );
}
