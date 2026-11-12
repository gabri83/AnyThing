import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { resolve } from 'path';
import { createApiRouter, type ApiContext, type ApplyResult } from './api';
import {
  configPath,
  loadConfig,
  normalizeConfig,
  saveConfig,
  userPluginDir,
  type AnythingConfig
} from './config';
import { CarThingConnector } from './device/carthing';
import { PluginHost } from './host';
import { inventory, type PluginSummary } from './inventory';
import { loadAll } from './loader';
import { Transport } from './transport';

export interface RuntimeOptions {
  version: string;
  /** Directory of the built UI. */
  uiDir?: string;
  configFile?: string;
  pluginDir?: string;
  /** Connect to a Car Thing when the config asks for it. Off in tests. */
  connectDevices?: boolean;
}

/** First non-loopback IPv4 address, for the URL to open on the device. */
function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

/**
 * Owns the config, the plugin host and the transport, and keeps them agreeing
 * with each other when settings change.
 *
 * Its reason to exist is live editing: adjusting a macro in the settings UI has
 * to reach the device without restarting the host, which means something has to
 * tear the plugins down and bring them back up under the new config. Doing that
 * in one place is what stops the host, the transport and the config from
 * drifting apart.
 */
export class Runtime {
  private config: AnythingConfig;
  private readonly host: PluginHost;
  private readonly transport: Transport;
  private readonly options: RuntimeOptions;
  private carThing: CarThingConnector | null = null;

  private constructor(config: AnythingConfig, options: RuntimeOptions) {
    this.config = config;
    this.options = options;
    this.host = new PluginHost(config);
    this.transport = new Transport({
      config,
      host: this.host,
      version: options.version,
      uiDir: options.uiDir,
      api: createApiRouter(this.apiContext())
    });
  }

  private get configFile(): string {
    return this.options.configFile ?? configPath();
  }

  private get pluginDir(): string {
    return this.options.pluginDir ?? userPluginDir();
  }

  public static async start(options: RuntimeOptions): Promise<Runtime> {
    const config = await loadConfig(options.configFile);
    const runtime = new Runtime(config, options);

    await loadAll(runtime.host, runtime.pluginDir);
    await runtime.transport.start();

    if (options.connectDevices && config.device.carThing.enabled) {
      runtime.carThing = new CarThingConnector({
        address: config.device.carThing.address,
        hostPort: runtime.transport.devicePort()
      });
      runtime.carThing.start();
    }

    return runtime;
  }

  public currentConfig(): AnythingConfig {
    return this.config;
  }

  public port(): number {
    return this.transport.port();
  }

  public deviceUrl(): string {
    // A loopback-only host is not reachable at the LAN address, so do not
    // print a URL that cannot work.
    const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(this.config.server.host);
    const address = loopbackOnly ? 'localhost' : (lanAddress() ?? this.config.server.host);
    // Ask the listener: a configured port of 0 means the real one is assigned
    // at bind time, and the URL has to carry the port that actually works.
    const port = this.transport.port() || this.config.server.port;
    const base = `http://${address}:${port}`;
    return this.config.auth.enabled
      ? `${base}/?token=${this.config.auth.token}`
      : `${base}/`;
  }

  /**
   * Validate and persist a new config, then bring the plugins back up under it.
   *
   * The token is deliberately carried over from the running config: a settings
   * form should not be able to change the credential by round-tripping a
   * redacted value, and rotation has its own endpoint.
   */
  public async applyConfig(raw: unknown): Promise<ApplyResult> {
    const next = normalizeConfig(raw);
    next.auth.token = this.config.auth.token;

    const restartRequired =
      next.server.port !== this.config.server.port ||
      next.server.host !== this.config.server.host;

    await saveConfig(next, this.configFile);
    this.config = next;
    this.transport.setConfig(next);

    // The keymap travels in the welcome frame, so a device already connected
    // would otherwise keep the old one until it reloaded.
    this.transport.broadcast({ t: 'input', input: next.input });

    await this.reloadPlugins();

    return { config: next, restartRequired };
  }

  /** Tear every plugin down and load them again under the current config. */
  public async reloadPlugins(): Promise<string[]> {
    await this.host.teardown();
    this.host.setConfig(this.config);
    await loadAll(this.host, this.pluginDir);

    // teardown leaves no plugins, and a reload that ends up empty emits
    // nothing, so tell the devices explicitly.
    this.transport.broadcast({ t: 'pages', pages: this.host.pages() });
    return this.host.ids();
  }

  public async rotateToken(): Promise<AnythingConfig> {
    this.config = {
      ...this.config,
      auth: {
        ...this.config.auth,
        enabled: true,
        token: randomBytes(16).toString('hex')
      }
    };
    await saveConfig(this.config, this.configFile);
    this.transport.setConfig(this.config);
    return this.config;
  }

  private apiContext(): ApiContext {
    return {
      getConfig: () => this.config,
      applyConfig: (raw) => this.applyConfig(raw),
      reloadPlugins: () => this.reloadPlugins(),
      inventory: (): Promise<PluginSummary[]> =>
        inventory(this.config, this.pluginDir),
      rotateToken: () => this.rotateToken(),
      invoke: async (plugin, action) => {
        if (!this.host.has(plugin)) {
          throw new Error(`Plugin "${plugin}" is not loaded`);
        }
        await this.host.invoke(plugin, action);
      },
      deviceUrl: () => this.deviceUrl(),
      paths: { config: this.configFile, plugins: this.pluginDir },
      isDeviceRequest: (request) => this.transport.isDeviceRequest(request)
    };
  }

  /** The Car Thing connector, when one is running. */
  public device(): CarThingConnector | null {
    return this.carThing;
  }

  public async stop(): Promise<void> {
    await this.carThing?.stop();
    await this.transport.stop();
    await this.host.teardown();
  }
}

/** Resolve the built UI directory relative to the compiled server. */
export function defaultUiDir(): string {
  return resolve(__dirname, '..', '..', 'ui', 'dist');
}
