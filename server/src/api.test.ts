import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TOKEN_HEADER, isLoopback } from './api';
import { Runtime } from './runtime';

async function scratchDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'anything-api-'));
}

/** fetch().json() is `unknown` under strict mode; tests assert on the shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(response: Response): Promise<any> {
  return response.json();
}

/** A runtime on an ephemeral port with its own config file and plugin dir. */
async function startRuntime(seed?: Record<string, unknown>) {
  const dir = await scratchDir();
  const configFile = join(dir, 'config.json');
  const pluginDir = join(dir, 'plugins');

  if (seed) {
    const { writeFile } = await import('fs/promises');
    await writeFile(configFile, JSON.stringify(seed), 'utf8');
  }

  const runtime = await Runtime.start({
    version: 'test',
    configFile,
    pluginDir
  });

  return { runtime, configFile, base: `http://127.0.0.1:${runtime.port()}` };
}

const BASE_CONFIG = {
  server: { host: '127.0.0.1', port: 0 },
  auth: { enabled: true, token: 'test-token' },
  plugins: {}
};

describe('isLoopback', () => {
  it('recognises loopback addresses, including IPv4-mapped IPv6', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isLoopback('192.168.1.40')).toBe(false);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('settings API', () => {
  let started: Awaited<ReturnType<typeof startRuntime>>;

  beforeEach(async () => {
    started = await startRuntime(BASE_CONFIG);
  });

  afterEach(async () => {
    await started.runtime.stop();
  });

  it('serves the config to a request from this machine without a token', async () => {
    // The settings page opens on the Mac with no token in the URL, and anything
    // running locally could read the config file anyway.
    const response = await fetch(`${started.base}/api/config`);
    expect(response.status).toBe(200);

    const body = await json(response);
    expect(body.config.server.host).toBe('127.0.0.1');
    expect(body.paths.config).toBe(started.configFile);
  });

  it('never returns the real token in the config', async () => {
    const body = await fetch(`${started.base}/api/config`).then(json);
    expect(body.config.auth.token).toBe('***');
  });

  it('accepts a token when one is supplied anyway', async () => {
    const response = await fetch(`${started.base}/api/config`, {
      headers: { [TOKEN_HEADER]: 'test-token' }
    });
    expect(response.status).toBe(200);
  });

  it('refuses a write carrying a foreign Origin', async () => {
    // Loopback is trusted, so a page in the browser must not be able to post
    // shell commands here.
    const response = await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify(BASE_CONFIG)
    });

    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatch(/Cross-origin write refused/);
  });

  it('allows a write whose Origin is the host itself', async () => {
    const response = await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${started.runtime.port()}`
      },
      body: JSON.stringify(BASE_CONFIG)
    });
    expect(response.status).toBe(200);
  });

  it('writes a macro list and keeps the token it was not sent', async () => {
    const macros = [
      { id: 'hello', label: 'Hello', type: 'shell', value: 'echo hi' }
    ];

    const response = await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...BASE_CONFIG,
        auth: { enabled: true, token: '***' },
        plugins: { macros: { macros } }
      })
    });

    expect(response.status).toBe(200);
    expect((await json(response)).restartRequired).toBe(false);

    // A redacted token round-tripping through the form must not become the
    // real credential.
    const onDisk = JSON.parse(await readFile(started.configFile, 'utf8'));
    expect(onDisk.auth.token).toBe('test-token');
    expect(onDisk.plugins.macros.macros).toEqual(macros);
  });

  it('flags a port change as needing a restart but keeps serving', async () => {
    const response = await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...BASE_CONFIG,
        server: { host: '127.0.0.1', port: 4321 }
      })
    });

    expect((await json(response)).restartRequired).toBe(true);
    // Still answering on the port it actually bound.
    expect((await fetch(`${started.base}/healthz`)).status).toBe(200);
  });

  it('rejects a malformed body with a message rather than a stack', async () => {
    const response = await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{ not json'
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('applies a disabled plugin without a restart', async () => {
    const before = await fetch(`${started.base}/healthz`).then(json);
    expect(before.plugins).toContain('sysmon');

    await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...BASE_CONFIG,
        plugins: { sysmon: { enabled: false } }
      })
    });

    const after = await fetch(`${started.base}/healthz`).then(json);
    expect(after.plugins).not.toContain('sysmon');
  });

  it('pushes a changed keymap to connected devices', async () => {
    const { WebSocket } = await import('ws');
    const { PROTOCOL_VERSION } = await import('@anything/shared');

    const socket = new WebSocket(`ws://127.0.0.1:${started.runtime.port()}/ws`);
    const frames: Array<{ t: string; input?: { keymap: Record<string, string> } }> = [];

    await new Promise<void>((resolveOpen) => {
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            t: 'hello',
            protocol: PROTOCOL_VERSION,
            client: 'test',
            token: 'test-token'
          })
        );
        resolveOpen();
      });
    });

    socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 200));

    await fetch(`${started.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...BASE_CONFIG,
        input: { keymap: { k: 'press' }, wheel: false, rotateFlushMs: 40 }
      })
    });
    await new Promise((r) => setTimeout(r, 300));
    socket.close();

    // A device already on screen must not need reloading to pick up a
    // re-learned dial.
    const pushed = frames.find((frame) => frame.t === 'input');
    expect(pushed?.input?.keymap).toEqual({ k: 'press' });
  });

  it('lists every plugin with its platform support', async () => {
    const body = await fetch(`${started.base}/api/plugins`).then(json);
    const ids = body.plugins.map((plugin: { id: string }) => plugin.id);

    expect(ids).toContain('sysmon');
    expect(ids).toContain('apple-music');

    const music = body.plugins.find((p: { id: string }) => p.id === 'apple-music');
    expect(music.supported).toBe(process.platform === 'darwin');
    if (process.platform !== 'darwin') {
      expect(music.note).toMatch(/needs darwin/);
    }
  });

  it('reloads plugins on demand', async () => {
    const body = await fetch(`${started.base}/api/plugins/reload`, {
      method: 'POST'
    }).then(json);
    expect(body.loaded).toContain('sysmon');
  });

  it('rotates the token and persists it', async () => {
    const body = await fetch(`${started.base}/api/rotate-token`, {
      method: 'POST'
    }).then(json);

    expect(body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.deviceUrl).toContain(body.token);

    const onDisk = JSON.parse(await readFile(started.configFile, 'utf8'));
    expect(onDisk.auth.token).toBe(body.token);
  });

  it('reports a clear error for an action on a plugin that is not loaded', async () => {
    const response = await fetch(`${started.base}/api/invoke/ghost/press`, {
      method: 'POST'
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/not loaded/);
  });
});

describe('settings API with auth disabled', () => {
  it('still serves and accepts writes', async () => {
    const started = await startRuntime({
      ...BASE_CONFIG,
      auth: { enabled: false, token: '' }
    });

    try {
      expect((await fetch(`${started.base}/api/config`)).status).toBe(200);
      const write = await fetch(`${started.base}/api/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...BASE_CONFIG, auth: { enabled: false } })
      });
      expect(write.status).toBe(200);
    } finally {
      await started.runtime.stop();
    }
  });
});
