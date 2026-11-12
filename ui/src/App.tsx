import { useCallback, useEffect, useRef, useState } from 'react';
import type { InputGesture } from '@anything/shared';
import { useConnection } from './connection';
import { useDeviceInput, type RawInputEvent } from './input';
import { InputInspector } from './InputInspector';
import { PromptView } from './PromptView';
import { SettingsView } from './settings/SettingsView';
import { TileView } from './tiles/TileView';

/** Most recent events shown in the inspector. */
const EVENT_LOG_LIMIT = 12;

/** The inspector is opened by visiting /#input, so it needs no tile of its own. */
function useHashFlag(flag: string): [boolean, () => void] {
  const [on, setOn] = useState(() => window.location.hash === `#${flag}`);

  useEffect(() => {
    const sync = () => setOn(window.location.hash === `#${flag}`);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [flag]);

  const clear = useCallback(() => {
    window.history.replaceState({}, '', window.location.pathname);
    setOn(false);
  }, []);

  return [on, clear];
}

export function App() {
  const { status, deniedReason, pages, notice, input, prompts, focus, invoke, answer } =
    useConnection();
  const [activePlugin, setActivePlugin] = useState<string | null>(null);
  const [inspecting, closeInspector] = useHashFlag('input');
  const [settingsOpen, closeSettings] = useHashFlag('settings');
  const [events, setEvents] = useState<RawInputEvent[]>([]);

  // Follow the host: keep the chosen page if it still exists, else fall back to
  // the first one. This survives a plugin being disabled while the device is on.
  useEffect(() => {
    if (pages.length === 0) {
      setActivePlugin(null);
      return;
    }
    setActivePlugin((current) =>
      current && pages.some((page) => page.plugin === current)
        ? current
        : pages[0].plugin
    );
  }, [pages]);

  // A plugin can ask for its page to be shown, e.g. when something needs you.
  useEffect(() => {
    if (focus && pages.some((page) => page.plugin === focus.plugin)) {
      setActivePlugin(focus.plugin);
    }
    // Only a new request should switch pages, not every tile update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const active = pages.find((page) => page.plugin === activePlugin) ?? null;

  // The oldest unanswered prompt owns the screen and the controls.
  const prompt = prompts.length > 0 ? prompts[0] : null;
  const promptBodyRef = useRef<HTMLDivElement | null>(null);
  const capturePrompt = useCallback(
    (gesture: InputGesture): boolean => {
      if (!prompt) return false;
      if (gesture === 'rotate-cw' || gesture === 'rotate-ccw') {
        const body = promptBodyRef.current;
        if (body) body.scrollTop += gesture === 'rotate-cw' ? 56 : -56;
        return true;
      }
      const role = gesture === 'press' ? 'primary' : gesture === 'back' ? 'secondary' : null;
      const choice = role && prompt.choices.find((candidate) => candidate.role === role);
      if (choice) answer(prompt.id, choice.id);
      // Presets are swallowed too: nothing behind a prompt should fire.
      return true;
    },
    [prompt, answer]
  );

  const recordEvent = useCallback((event: RawInputEvent) => {
    setEvents((current) => [event, ...current].slice(0, EVENT_LOG_LIMIT));
  }, []);

  // The dial, back button and presets belong to whichever page is showing, so
  // the same hardware means volume here and something else elsewhere.
  useDeviceInput({
    input,
    bindings: active?.controls,
    invoke: (action, payload) => {
      if (active) invoke(active.plugin, action, payload);
    },
    capture: prompt ? capturePrompt : undefined,
    onRaw: inspecting ? recordEvent : undefined,
    // While inspecting, report events without firing actions: you should be
    // able to find out what a button does without it muting your mic.
    inspectOnly: inspecting
  });

  if (settingsOpen) {
    return <SettingsView onClose={closeSettings} />;
  }

  if (inspecting) {
    return (
      <div className="app">
        <InputInspector
          input={input}
          bindings={active?.controls}
          events={events}
          onClose={closeInspector}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="bar">
        <div className="tabs" role="tablist">
          {pages.map((page) => (
            <button
              key={page.plugin}
              type="button"
              role="tab"
              className="tab"
              aria-selected={page.plugin === activePlugin}
              onClick={() => setActivePlugin(page.plugin)}
            >
              {page.icon && <span className="tab-icon">{page.icon}</span>}
              {page.title}
            </button>
          ))}
        </div>
        <a
          className="bar-link"
          href="#settings"
          title="Settings"
          aria-label="Settings"
        >
          {'\u2699'}
        </a>
        {active?.controls?.rotate && (
          <span className="dial-hint" title="The dial controls this page">
            {'◌'}
          </span>
        )}
        <span
          className="status-dot"
          data-status={status}
          title={`Connection: ${status}`}
        />
      </div>

      {status === 'denied' ? (
        <div className="overlay">
          <h1>Not allowed in</h1>
          <p>{deniedReason}</p>
          <p>
            Run <code>anything url</code> on your Mac and open the link it prints.
          </p>
        </div>
      ) : pages.length === 0 ? (
        <div className="overlay">
          <h1>{status === 'open' ? 'No plugins loaded' : 'Looking for the host'}</h1>
          <p>
            {status === 'open'
              ? 'The host is running but every plugin is disabled or unsupported here.'
              : 'Reconnecting automatically. Check that the host is running on your Mac.'}
          </p>
        </div>
      ) : (
        <div className="grid">
          {active?.tiles.map((tile) => (
            <TileView
              key={tile.id}
              tile={tile}
              invoke={(action, payload) => invoke(active.plugin, action, payload)}
            />
          ))}
        </div>
      )}

      {notice && (
        <div className="toast" data-level={notice.level} key={notice.key}>
          {notice.message}
        </div>
      )}

      {prompt && (
        <PromptView
          key={prompt.id}
          ref={promptBodyRef}
          prompt={prompt}
          waiting={prompts.length - 1}
          answer={(choice) => answer(prompt.id, choice)}
        />
      )}
    </div>
  );
}
