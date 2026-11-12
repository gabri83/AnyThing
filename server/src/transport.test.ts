import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { definePlugin, PROTOCOL_VERSION, type ServerMessage } from '@anything/shared';
import { WebSocket } from 'ws';
import { DEFAULT_CONFIG, type AnythingConfig } from './config';
import { PluginHost } from './host';
import { Transport } from './transport';

const TOKEN = 'correct-horse-battery-staple';

function config(overrides: Partial<AnythingConfig['auth']> = {}): AnythingConfig {
  return {
    ...DEFAULT_CONFIG,
    // Port 0 lets the OS pick, so tests never collide with a real host.
    server: { host: '127.0.0.1', port: 0 },
    auth: { enabled: true, token: TOKEN, allowRemoteConfig: false, ...overrides },
    plugins: {}
  };
}

/** Connect, send `hello`, and collect frames until the socket closes or idles. */
function exchange(
  port: number,
  hello: Record<string, unknown>,
  afterPages?: Record<string, unknown>
): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frames: ServerMessage[] = [];
    let timer: NodeJS.Timeout;

    const finish = () => {
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      resolve(frames);
    };

    socket.on('open', () => socket.send(JSON.stringify(hello)));
    socket.on('error', reject);
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as ServerMessage;
      frames.push(frame);
      if (frame.t === 'pages' && afterPages) {
        socket.send(JSON.stringify(afterPages));
      }
      clearTimeout(timer);
      timer = setTimeout(finish, 150);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(frames);
    });

    timer = setTimeout(finish, 1500);
  });
}

describe('Transport', () => {
  let host: PluginHost;
  let transport: Transport;
  let pressed: unknown[];

  beforeEach(async () => {
    pressed = [];
    host = new PluginHost(config());
    await host.register(
      definePlugin({
        manifest: { id: 'demo', name: 'Demo', version: '1.0.0' },
        setup(api) {
          api.onAction('press', (payload) => {
            pressed.push(payload);
          });
          api.setTiles([
            { kind: 'button', id: 'go', label: 'Go', action: 'press' }
          ]);
        }
      })
    );

    transport = new Transport({ config: config(), host, version: '1.0.0-test' });
    await transport.start();
  });

  afterEach(async () => {
    await transport.stop();
    await host.teardown();
  });

  it('serves health and status over HTTP', async () => {
    const base = `http://127.0.0.1:${transport.port()}`;

    const health = await fetch(`${base}/healthz`).then((res) => res.json());
    expect(health).toEqual({
      status: 'ok',
      version: '1.0.0-test',
      plugins: ['demo']
    });

    const status = await fetch(`${base}/status`).then((res) => res.json());
    expect(status).toMatchObject({ authRequired: true, clients: 0 });
  });

  it('404s a file no plugin registered', async () => {
    const response = await fetch(
      `http://127.0.0.1:${transport.port()}/files/demo/nope.jpg`
    );
    expect(response.status).toBe(404);
  });

  it('sends welcome and pages to a client with the right token', async () => {
    const frames = await exchange(transport.port(), {
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      client: 'test',
      token: TOKEN
    });

    expect(frames.map((frame) => frame.t)).toEqual(['welcome', 'pages', 'prompts']);
    const pages = frames[1];
    if (pages.t !== 'pages') throw new Error('expected pages');
    expect(pages.pages).toHaveLength(1);
    expect(pages.pages[0].tiles[0].id).toBe('go');
  });

  it('denies a missing token', async () => {
    const frames = await exchange(transport.port(), {
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      client: 'test'
    });

    expect(frames).toHaveLength(1);
    if (frames[0].t !== 'denied') throw new Error('expected denied');
    expect(frames[0].reason).toBe('bad-token');
  });

  it('denies a wrong token, including one of a different length', async () => {
    for (const token of ['wrong', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      const frames = await exchange(transport.port(), {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        client: 'test',
        token
      });
      if (frames[0].t !== 'denied') throw new Error(`expected denied for ${token}`);
      expect(frames[0].reason).toBe('bad-token');
    }
  });

  it('denies a mismatched protocol version', async () => {
    const frames = await exchange(transport.port(), {
      t: 'hello',
      protocol: PROTOCOL_VERSION + 99,
      client: 'test',
      token: TOKEN
    });

    if (frames[0].t !== 'denied') throw new Error('expected denied');
    expect(frames[0].reason).toBe('protocol-mismatch');
  });

  it('ignores an invoke from a client that never authenticated', async () => {
    const frames = await exchange(
      transport.port(),
      { t: 'hello', protocol: PROTOCOL_VERSION, client: 'test', token: 'wrong' },
      { t: 'invoke', plugin: 'demo', action: 'press' }
    );

    expect(frames.some((frame) => frame.t === 'pages')).toBe(false);
    expect(pressed).toEqual([]);
  });

  it('routes an invoke from an authenticated client to the plugin', async () => {
    await exchange(
      transport.port(),
      { t: 'hello', protocol: PROTOCOL_VERSION, client: 'test', token: TOKEN },
      { t: 'invoke', plugin: 'demo', action: 'press', payload: { position: 7 } }
    );

    expect(pressed).toEqual([{ position: 7 }]);
  });

  it('ignores a malformed frame without dropping the connection', async () => {
    const frames = await exchange(
      transport.port(),
      { t: 'hello', protocol: PROTOCOL_VERSION, client: 'test', token: TOKEN },
      { t: 'nonsense', whatever: true }
    );

    expect(frames.map((frame) => frame.t)).toEqual(['welcome', 'pages', 'prompts']);
  });
});

describe('Transport serving a built UI', () => {
  // Regression: Express 5 rejects a bare '*' route, so the SPA fallback has to
  // be middleware. That path only runs when a built UI directory exists.
  it('starts with a uiDir and serves index.html for an unknown path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anything-ui-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>ui</title>', 'utf8');

    const host = new PluginHost(config());
    const transport = new Transport({
      config: config(),
      host,
      version: 'test',
      uiDir: dir
    });

    await expect(transport.start()).resolves.toBeUndefined();

    try {
      const base = `http://127.0.0.1:${transport.port()}`;

      const root = await fetch(`${base}/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain('<title>ui</title>');

      // A deep link the UI owns must still return the app shell.
      const deep = await fetch(`${base}/some/client/route`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain('<title>ui</title>');

      // API routes must still win over the fallback.
      const health = await fetch(`${base}/healthz`);
      expect(await health.json()).toMatchObject({ status: 'ok' });
    } finally {
      await transport.stop();
      await host.teardown();
    }
  });
});

describe('Transport failing to bind', () => {
  // Regression: the WebSocket server re-emits the HTTP server's errors, so a
  // busy port used to surface as an unhandled 'error' event and a stack trace.
  it('rejects with an actionable message when the port is taken', async () => {
    const first = new PluginHost(config());
    const holding = new Transport({ config: config(), host: first, version: 'test' });
    await holding.start();

    const taken: AnythingConfig = {
      ...config(),
      server: { host: '127.0.0.1', port: holding.port() }
    };
    const second = new PluginHost(taken);
    const blocked = new Transport({ config: taken, host: second, version: 'test' });

    try {
      await expect(blocked.start()).rejects.toThrow(
        new RegExp(`Port ${holding.port()} is already in use`)
      );
    } finally {
      await holding.stop();
      await first.teardown();
      await second.teardown();
    }
  });
});

describe('Transport with auth disabled', () => {
  it('accepts a client that sends no token', async () => {
    const open = config({ enabled: false, token: '' });
    const host = new PluginHost(open);
    const transport = new Transport({ config: open, host, version: 'test' });
    await transport.start();

    try {
      const frames = await exchange(transport.port(), {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        client: 'test'
      });
      expect(frames.map((frame) => frame.t)).toEqual(['welcome', 'pages', 'prompts']);
    } finally {
      await transport.stop();
      await host.teardown();
    }
  });
});
