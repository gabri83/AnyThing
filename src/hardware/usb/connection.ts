import { EventEmitter } from 'events';
import * as usb from 'usb';
import Debug from 'debug';
import { UsbProtocolHandler } from './protocol';
import { DisplayProtocol } from './display';

const debug = Debug('anything:usb:connection');

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  RECOVERING = 'recovering'
}

export interface ConnectionConfig {
  vendorId: number;
  productId: number;
  maxRetries: number;
  retryDelay: number;
  logDir?: string;
}

export class UsbConnectionManager extends EventEmitter {
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private protocol: UsbProtocolHandler | null = null;
  private display: DisplayProtocol | null = null;
  private device: usb.Device | null = null;
  private retryCount: number = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(private config: ConnectionConfig) {
    super();
    this.setupDeviceWatcher();
  }

  private setupDeviceWatcher(): void {
    // Watch for USB device attach/detach events
    usb.on('attach', (device: usb.Device) => {
      if (this.isTargetDevice(device)) {
        debug('Target device attached');
        this.handleDeviceAttached(device);
      }
    });

    usb.on('detach', (device: usb.Device) => {
      if (this.isTargetDevice(device)) {
        debug('Target device detached');
        this.handleDeviceDetached();
      }
    });

    // Poll for device presence periodically as a backup
    this.watchTimer = setInterval(() => {
      if (this.state === ConnectionState.DISCONNECTED) {
        this.findAndConnect();
      }
    }, 5000);
  }

  private isTargetDevice(device: usb.Device): boolean {
    return (
      device.deviceDescriptor.idVendor === this.config.vendorId &&
      device.deviceDescriptor.idProduct === this.config.productId
    );
  }

  private async handleDeviceAttached(device: usb.Device): Promise<void> {
    if (this.state !== ConnectionState.DISCONNECTED) return;

    this.device = device;
    await this.connect();
  }

  private async handleDeviceDetached(): Promise<void> {
    await this.cleanup();
    this.setState(ConnectionState.DISCONNECTED);
    this.emit('disconnected');

    // Try to reconnect if device reappears
    this.scheduleReconnect();
  }

  private setState(newState: ConnectionState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit('stateChange', { old: oldState, new: newState });
    debug(`Connection state changed: ${oldState} -> ${newState}`);
  }

  public async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) return;

    this.setState(ConnectionState.CONNECTING);

    try {
      if (!this.device) {
        await this.findAndConnect();
        return;
      }

      // Initialize protocol handler
      this.protocol = new UsbProtocolHandler(this.device, this.config.logDir);
      await this.protocol.initialize();

      // Initialize display protocol
      this.display = new DisplayProtocol(this.protocol);
      await this.display.initialize();

      // Setup error handlers
      this.protocol.on('error', this.handleError.bind(this));

      this.setState(ConnectionState.CONNECTED);
      this.retryCount = 0;
      this.emit('connected');

    } catch (error) {
      debug('Connection failed:', error);
      await this.handleError(error);
    }
  }

  private async findAndConnect(): Promise<void> {
    const devices = usb.getDeviceList();
    this.device = devices.find(d => this.isTargetDevice(d)) || null;

    if (this.device) {
      await this.connect();
    } else {
      this.setState(ConnectionState.DISCONNECTED);
      this.scheduleReconnect();
    }
  }

  private async handleError(error: Error): Promise<void> {
    debug('Device error:', error);
    this.setState(ConnectionState.ERROR);
    this.emit('error', error);

    // Attempt recovery
    await this.attemptRecovery();
  }

  private async attemptRecovery(): Promise<void> {
    if (this.state === ConnectionState.RECOVERING) return;

    this.setState(ConnectionState.RECOVERING);
    debug(`Attempting recovery (attempt ${this.retryCount + 1}/${this.config.maxRetries})`);

    try {
      // Try to cleanup existing connections
      await this.cleanup();

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));

      // Attempt to reconnect
      await this.connect();

    } catch (error) {
      debug('Recovery attempt failed:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;

    if (this.retryCount < this.config.maxRetries) {
      this.retryCount++;
      const delay = this.config.retryDelay * Math.pow(2, this.retryCount - 1);
      debug(`Scheduling reconnection attempt in ${delay}ms`);

      this.retryTimer = setTimeout(async () => {
        this.retryTimer = null;
        await this.connect();
      }, delay);
    } else {
      debug('Max retry attempts reached');
      this.emit('maxRetriesReached');
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.protocol) {
        await this.protocol.cleanup();
        this.protocol = null;
      }

      if (this.device) {
        this.device = null;
      }

      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    } catch (error) {
      debug('Error during cleanup:', error);
    }
  }

  public async disconnect(): Promise<void> {
    await this.cleanup();
    this.setState(ConnectionState.DISCONNECTED);
    this.emit('disconnected');
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getProtocol(): UsbProtocolHandler | null {
    return this.protocol;
  }

  public getDisplay(): DisplayProtocol | null {
    return this.display;
  }

  public getDevice(): usb.Device | null {
    return this.device;
  }
}