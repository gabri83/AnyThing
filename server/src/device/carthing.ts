import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import { kioskNavigate, kioskUrl } from './cdp';

/**
 * Puts AnyThing on a Car Thing whenever one is plugged into this Mac.
 *
 * The device (running the Bridgething image) shows up as a USB network link
 * with ssh open and a Chromium kiosk whose debug port listens on the device's
 * own loopback. One ssh process carries everything:
 *
 *   -R  device 127.0.0.1:DEVICE_SIDE_PORT -> this host's tethered listener,
 *       so the kiosk can load the UI without the host listening on the network
 *   -L  a local port -> the kiosk's debug port, so this host can tell the
 *       kiosk which page to show
 *
 * Nothing is installed on the device, and unplugging it puts it back as it was.
 */

/** Port the UI is reachable on from the device's side of the tunnel. */
export const DEVICE_SIDE_PORT = 7780;
/** The kiosk's DevTools port, bound to the device's loopback. */
const KIOSK_DEBUG_PORT = 9223;
/** The Bridgething image's own UI, handed the screen back on shutdown. */
const FIRMWARE_URL = 'http://127.0.0.1:8891/';

const RETRY_MS = 3000;
/**
 * After connecting, keep putting the UI back for this long: a device that is
 * still booting loads its own page a few seconds after the browser comes up.
 * Afterwards the screen is left alone, so the firmware's own launcher remains
 * reachable (press `m` five times).
 */
const SETTLE_MS = 60_000;

export interface CarThingOptions {
  /** Address of the device on the USB link. */
  address: string;
  /** Port of the host's tethered-device listener. */
  hostPort: number;
  log?: (message: string) => void;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CarThingConnector {
  private readonly options: CarThingOptions;
  private stopping = false;
  private tunnel: ChildProcess | null = null;
  private debugPort = 0;
  private shown = false;
  private loop: Promise<void> | null = null;

  constructor(options: CarThingOptions) {
    this.options = options;
  }

  private log(message: string): void {
    (this.options.log ?? console.log)(`[carthing] ${message}`);
  }

  /** URL the kiosk loads: this host's UI, seen from the device. */
  public get uiUrl(): string {
    return `http://127.0.0.1:${DEVICE_SIDE_PORT}/`;
  }

  /** True while the UI is on a connected device's screen. */
  public get connected(): boolean {
    return this.shown;
  }

  /** Local port forwarded to the kiosk's debug port, or 0 when not connected. */
  public get kioskDebugPort(): number {
    return this.tunnel ? this.debugPort : 0;
  }

  public start(): void {
    if (this.loop) return;
    this.log(`watching for a Car Thing at ${this.options.address}`);
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      await this.session();
      if (!this.stopping) await sleep(RETRY_MS);
    }
  }

  private openTunnel(): ChildProcess {
    return spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        '-o', 'ConnectTimeout=3',
        '-o', 'ServerAliveInterval=5',
        '-o', 'ServerAliveCountMax=2',
        '-o', 'ExitOnForwardFailure=yes',
        '-N',
        '-R', `127.0.0.1:${DEVICE_SIDE_PORT}:127.0.0.1:${this.options.hostPort}`,
        '-L', `127.0.0.1:${this.debugPort}:127.0.0.1:${KIOSK_DEBUG_PORT}`,
        `root@${this.options.address}`
      ],
      { stdio: 'ignore' }
    );
  }

  /** One connection to the device, from tunnel up to tunnel down. */
  private async session(): Promise<void> {
    this.debugPort = await freePort();
    const tunnel = this.openTunnel();
    this.tunnel = tunnel;
    let exited = false;
    tunnel.once('exit', () => (exited = true));
    tunnel.once('error', () => (exited = true));

    let connectedAt = 0;
    /** What the kiosk was showing before we took it, to hand back on shutdown. */
    let previous: string | null = null;
    this.shown = false;

    while (!this.stopping && !exited) {
      const url = await kioskUrl(this.debugPort);
      if (url !== null) {
        connectedAt = connectedAt || Date.now();
        const settling = Date.now() - connectedAt < SETTLE_MS;
        if (url.startsWith(this.uiUrl)) {
          this.shown = true;
        } else if (!this.shown || settling) {
          previous = previous ?? url;
          if (await kioskNavigate(this.debugPort, this.uiUrl)) {
            if (!this.shown) this.log('AnyThing is on the Car Thing screen');
            this.shown = true;
          }
        }
      }
      const settling = connectedAt === 0 || Date.now() - connectedAt < SETTLE_MS;
      await sleep(!this.shown || settling ? 2000 : 5000);
    }

    if (!exited) {
      // Shutting down with the device still attached: give the screen back.
      if (this.shown) await kioskNavigate(this.debugPort, previous ?? FIRMWARE_URL);
      tunnel.kill();
    } else if (this.shown) {
      this.log('Car Thing disconnected');
    }
    this.shown = false;
    this.tunnel = null;
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    await this.loop;
    this.loop = null;
  }
}
