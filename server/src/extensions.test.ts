import { definePlugin, PROTOCOL_VERSION, type PluginApi, type ServerMessage } from '@anything/shared';
import { WebSocket } from 'ws';
import { DEFAULT_CONFIG, type AnythingConfig } from './config';
import { PluginHost } from './host';
import { Transport } from './transport';

/**
 * Prompts, webhooks and the tethered-device listener: the parts of the plugin
 * contract that let a plugin be told things by other programs and ask the
 * person at the device a question.
 */

const TOKEN = 'correct-horse-battery-staple';

function config(): AnythingConfig {
  return {
    ...DEFAULT_CONFIG,
    server: { host: '127.0.0.1', port: 0 },
    auth: { enabled: true, token: TOKEN, allowRemoteConfig: false },
    plugins: {}
  };
}

const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A connected client that records what it is sent. */
async function client(port: number, hello: Record<string, unknown> = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames: ServerMessage[] = [];
  socket.on('message', (raw) => frames.push(JSON.parse(raw.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  socket.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, client: 'test', ...hello }));
  await tick(80);
  return {
    frames,
    send: (message: Record<string, unknown>) => socket.send(JSON.stringify(message)),
    last: <T extends ServerMessage['t']>(type: T) =>
      [...frames].reverse().find((frame) => frame.t === type) as
        | Extract<ServerMessage, { t: T }>
        | undefined,
    close: () => socket.close()
  };
}

describe('plugin extensions', () => {
  let host: PluginHost;
  let transport: Transport;
  let api: PluginApi;

  beforeEach(async () => {
    host = new PluginHost(config());
    await host.register(
      definePlugin({
        manifest: { id: 'demo', name: 'Demo', version: '1.0.0' },
        setup(given) {
          api = given;
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

  const ask = (id = 'q1', timeoutMs?: number) =>
    api.prompt(
      {
        title: 'Run it?',
        choices: [
          { id: 'no', label: 'No', role: 'secondary' },
          { id: 'yes', label: 'Yes', role: 'primary' }
        ]
      },
      { id, timeoutMs }
    );

  describe('prompts', () => {
    it('shows a prompt on the device and resolves with the answer', async () => {
      const device = await client(transport.port(), { token: TOKEN });
      const answer = ask();
      await tick();
      expect(device.last('prompts')?.prompts).toMatchObject([
        { id: 'q1', plugin: 'demo', title: 'Run it?' }
      ]);

      device.send({ t: 'answer', prompt: 'q1', choice: 'yes' });
      await expect(answer).resolves.toBe('yes');
      await tick();
      expect(device.last('prompts')?.prompts).toEqual([]);
      device.close();
    });

    it('sends a pending prompt to a device that connects later', async () => {
      const answer = ask();
      const device = await client(transport.port(), { token: TOKEN });
      expect(device.last('prompts')?.prompts).toHaveLength(1);
      api.dismissPrompt('q1');
      await expect(answer).resolves.toBeNull();
      device.close();
    });

    it('ignores an answer that is not one of the choices', async () => {
      const answer = ask();
      expect(host.answerPrompt('q1', 'maybe')).toBe(false);
      expect(host.pendingPrompts()).toHaveLength(1);
      expect(host.answerPrompt('q1', 'no')).toBe(true);
      await expect(answer).resolves.toBe('no');
    });

    it('resolves null when nobody answers in time', async () => {
      await expect(ask('q2', 40)).resolves.toBeNull();
      expect(host.pendingPrompts()).toEqual([]);
    });

    it('takes prompts down when the plugin is torn down', async () => {
      const answer = ask();
      await host.teardown();
      await expect(answer).resolves.toBeNull();
    });
  });

  describe('webhooks', () => {
    it('routes a request to the plugin and returns its response', async () => {
      api.onRequest('event', (request) => ({
        body: { got: request.body, method: request.method, q: request.query.kind }
      }));
      const response = await fetch(
        `http://127.0.0.1:${transport.port()}/hooks/demo/event?kind=x`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hello: 'world' })
        }
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ got: { hello: 'world' }, method: 'POST', q: 'x' });
    });

    it('waits for a handler that takes its time', async () => {
      api.onRequest('slow', async () => {
        await tick(60);
        return { status: 202, body: { done: true } };
      });
      const response = await fetch(`http://127.0.0.1:${transport.port()}/hooks/demo/slow`);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ done: true });
    });

    it('404s a path no plugin registered', async () => {
      const response = await fetch(`http://127.0.0.1:${transport.port()}/hooks/demo/nope`);
      expect(response.status).toBe(404);
    });

    it('refuses a webhook arriving through the tethered-device listener', async () => {
      api.onRequest('event', () => ({ body: { reached: true } }));
      const response = await fetch(`http://127.0.0.1:${transport.devicePort()}/hooks/demo/event`);
      expect(response.status).toBe(403);
    });
  });

  describe('tethered device listener', () => {
    it('accepts a device with no token', async () => {
      const device = await client(transport.devicePort());
      expect(device.frames.map((frame) => frame.t)).toEqual(['welcome', 'pages', 'prompts']);
      device.close();
    });

    it('still demands the token on the main listener', async () => {
      const stranger = await client(transport.port());
      expect(stranger.frames.map((frame) => frame.t)).toEqual(['denied']);
      stranger.close();
    });
  });

  it('tells devices when a plugin asks for its page', async () => {
    const device = await client(transport.port(), { token: TOKEN });
    api.focus();
    await tick();
    expect(device.last('focus')).toEqual({ t: 'focus', plugin: 'demo' });
    device.close();
  });
});
