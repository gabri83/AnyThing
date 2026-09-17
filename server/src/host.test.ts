import { definePlugin, type Plugin, type PluginApi, type Tile } from '@anything/shared';
import { DEFAULT_CONFIG, type AnythingConfig } from './config';
import { PluginHost } from './host';

function config(overrides: Partial<AnythingConfig> = {}): AnythingConfig {
  return { ...DEFAULT_CONFIG, plugins: {}, ...overrides };
}

const textTile = (id: string, value = 'v'): Tile => ({
  kind: 'text',
  id,
  label: id,
  value
});

function stub(
  id: string,
  setup: (api: PluginApi) => void | Promise<void> = () => {},
  extra: Partial<Plugin['manifest']> = {}
): Plugin {
  return definePlugin({
    manifest: { id, name: id, version: '1.0.0', ...extra },
    setup
  });
}

describe('PluginHost.register', () => {
  it('loads a plugin and exposes it as a page', async () => {
    const host = new PluginHost(config());
    await host.register(stub('alpha', (api) => api.setTiles([textTile('one')])));

    expect(host.ids()).toEqual(['alpha']);
    expect(host.pages()).toEqual([
      { plugin: 'alpha', title: 'alpha', icon: undefined, tiles: [textTile('one')] }
    ]);
  });

  it('skips a plugin disabled in config', async () => {
    const host = new PluginHost(config({ plugins: { alpha: { enabled: false } } }));
    await expect(host.register(stub('alpha'))).resolves.toBe(false);
    expect(host.ids()).toEqual([]);
  });

  it('skips a plugin that does not support this platform', async () => {
    const host = new PluginHost(config());
    const foreign = process.platform === 'darwin' ? 'win32' : 'darwin';
    await expect(
      host.register(stub('alpha', () => {}, { platforms: [foreign] }))
    ).resolves.toBe(false);
    expect(host.ids()).toEqual([]);
  });

  it('rejects a duplicate id', async () => {
    const host = new PluginHost(config());
    await host.register(stub('alpha'));
    await expect(host.register(stub('alpha'))).rejects.toThrow(/Duplicate plugin id/);
  });

  it('rolls back a plugin whose setup throws, leaving no timers behind', async () => {
    const host = new PluginHost(config());
    let ticks = 0;

    const plugin = stub('bad', (api) => {
      api.every(50, () => {
        ticks += 1;
      });
      throw new Error('boom');
    });

    await expect(host.register(plugin)).rejects.toThrow(/bad failed to set up: boom/);
    expect(host.ids()).toEqual([]);

    const afterRollback = ticks;
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The immediate first run may have happened; the interval must not continue.
    expect(ticks).toBe(afterRollback);
  });

  it('merges the plugin manifest defaults under user config', async () => {
    const host = new PluginHost(config({ plugins: { alpha: { b: 2 } } }));
    let seen: Record<string, unknown> = {};

    await host.register(
      stub('alpha', (api) => {
        seen = api.config;
      }, { defaultConfig: { a: 1, b: 1 } })
    );

    expect(seen).toEqual({ a: 1, b: 2 });
  });
});

describe('PluginHost tile broadcasting', () => {
  it('emits tiles only when they actually change', async () => {
    const host = new PluginHost(config());
    const emitted: Tile[][] = [];
    host.on('tiles', (_id: string, tiles: Tile[]) => emitted.push(tiles));

    let publish: (tiles: Tile[]) => void = () => {};
    await host.register(
      stub('alpha', (api) => {
        publish = api.setTiles;
      })
    );

    publish([textTile('one', 'a')]);
    publish([textTile('one', 'a')]); // identical, must not broadcast
    publish([textTile('one', 'b')]);

    expect(emitted).toHaveLength(2);
    expect(host.tilesFor('alpha')).toEqual([textTile('one', 'b')]);
  });
});

describe('PluginHost.invoke', () => {
  it('routes an invocation with its payload', async () => {
    const host = new PluginHost(config());
    const calls: unknown[] = [];

    await host.register(
      stub('alpha', (api) => {
        api.onAction('press', (payload) => {
          calls.push(payload);
        });
      })
    );

    await host.invoke('alpha', 'press', { position: 42 });
    expect(calls).toEqual([{ position: 42 }]);
  });

  it('notices an unknown plugin instead of throwing', async () => {
    const host = new PluginHost(config());
    const notices: string[] = [];
    host.on('notice', (_level: string, message: string) => notices.push(message));

    await host.invoke('ghost', 'press');
    expect(notices).toEqual(['No such plugin: ghost']);
  });

  it('notices an unknown action instead of throwing', async () => {
    const host = new PluginHost(config());
    const notices: string[] = [];
    host.on('notice', (_level: string, message: string) => notices.push(message));

    await host.register(stub('alpha'));
    await host.invoke('alpha', 'nope');
    expect(notices).toEqual(['alpha has no action "nope"']);
  });

  it('reports a failing handler as an error notice and stays up', async () => {
    const host = new PluginHost(config());
    const notices: Array<[string, string]> = [];
    host.on('notice', (level: string, message: string) => notices.push([level, message]));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await host.register(
      stub('alpha', (api) => {
        api.onAction('press', () => {
          throw new Error('osascript said no');
        });
      })
    );

    await expect(host.invoke('alpha', 'press')).resolves.toBeUndefined();
    expect(notices).toEqual([['error', 'alpha: osascript said no']]);
    jest.restoreAllMocks();
  });
});

describe('PluginApi.every', () => {
  it('rejects an interval that would hammer the host', async () => {
    const host = new PluginHost(config());
    await expect(
      host.register(
        stub('alpha', (api) => {
          api.every(10, () => {});
        })
      )
    ).rejects.toThrow(/interval must be >= 50ms/);
  });

  it('skips a run that overlaps the previous one', async () => {
    const host = new PluginHost(config());
    let started = 0;
    const releases: Array<() => void> = [];

    await host.register(
      stub('alpha', (api) => {
        api.every(50, () => {
          started += 1;
          return new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        });
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 220));
    // The first run never settled, so no later tick may have started one.
    expect(started).toBe(1);
    for (const release of releases) release();
    await host.teardown();
  });

  it('stops scheduled work at teardown', async () => {
    const host = new PluginHost(config());
    let ticks = 0;

    await host.register(
      stub('alpha', (api) => {
        api.every(50, () => {
          ticks += 1;
        });
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    await host.teardown();
    const atTeardown = ticks;

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(ticks).toBe(atTeardown);
    expect(host.ids()).toEqual([]);
  });

  it('runs teardown hooks and survives one that throws', async () => {
    const host = new PluginHost(config());
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];

    await host.register({
      manifest: { id: 'alpha', name: 'alpha', version: '1.0.0' },
      setup: () => {},
      teardown: () => {
        order.push('alpha');
        throw new Error('nope');
      }
    });
    await host.register({
      manifest: { id: 'beta', name: 'beta', version: '1.0.0' },
      setup: () => {},
      teardown: () => {
        order.push('beta');
      }
    });

    await host.teardown();
    expect(order).toEqual(['alpha', 'beta']);
    jest.restoreAllMocks();
  });
});

describe('PluginApi.serveFile', () => {
  it('returns a namespaced URL and resolves it back to the path', async () => {
    const host = new PluginHost(config());
    let url = '';

    await host.register(
      stub('alpha', (api) => {
        url = api.serveFile('art.jpg', '/tmp/art.jpg');
      })
    );

    expect(url).toBe('/files/alpha/art.jpg');
    expect(host.resolveFile('alpha', 'art.jpg')).toBe('/tmp/art.jpg');
  });

  it('refuses a path-traversing name', async () => {
    const host = new PluginHost(config());
    await expect(
      host.register(
        stub('alpha', (api) => {
          api.serveFile('../../etc/passwd', '/tmp/x');
        })
      )
    ).rejects.toThrow(/bare filename/);
  });

  it('refuses a relative path', async () => {
    const host = new PluginHost(config());
    await expect(
      host.register(
        stub('alpha', (api) => {
          api.serveFile('art.jpg', 'relative/art.jpg');
        })
      )
    ).rejects.toThrow(/absolute path/);
  });

  it('unregisters a file when passed null', async () => {
    const host = new PluginHost(config());
    let api!: PluginApi;
    await host.register(
      stub('alpha', (given) => {
        api = given;
      })
    );

    api.serveFile('art.jpg', '/tmp/art.jpg');
    expect(host.resolveFile('alpha', 'art.jpg')).toBe('/tmp/art.jpg');
    api.serveFile('art.jpg', null);
    expect(host.resolveFile('alpha', 'art.jpg')).toBeUndefined();
  });
});
