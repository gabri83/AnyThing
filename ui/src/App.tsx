import { useEffect, useState } from 'react';
import { useConnection } from './connection';
import { TileView } from './tiles/TileView';

export function App() {
  const { status, deniedReason, pages, notice, invoke } = useConnection();
  const [activePlugin, setActivePlugin] = useState<string | null>(null);

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

  const active = pages.find((page) => page.plugin === activePlugin) ?? null;

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
    </div>
  );
}
