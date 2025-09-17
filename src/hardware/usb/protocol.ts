import { EventEmitter } from 'events';
import * as usb from 'usb';
import Debug from 'debug';
import { UsbLogger, PacketDirection } from './logger';

const debug = Debug('anything:usb:protocol');

// Protocol constants
const USB_PACKET_SIZE = 64;
const USB_TIMEOUT = 1000;

// Command opcodes
export enum UsbOpcode {
  // Control commands
  INIT = 0x01,
  RESET = 0x02,
  GET_STATUS = 0x03,
  SET_POWER = 0x04,

  // Display commands
  DISPLAY_INIT = 0x10,
  DISPLAY_UPDATE = 0x11,
  DISPLAY_PARTIAL = 0x12,
  DISPLAY_POWER = 0x13,
  SET_BRIGHTNESS = 0x14,

  // Audio commands
  AUDIO_INIT = 0x20,
  AUDIO_CONFIG = 0x21,
  AUDIO_VOLUME = 0x22,
  AUDIO_MUTE = 0x23,

  // System commands
  GET_VERSION = 0xF0,
  GET_SERIAL = 0xF1,
  DEBUG_LOG = 0xFF
}

// Response codes
export enum UsbResponse {
  OK = 0x00,
  ERROR = 0x01,
  INVALID_PARAM = 0x02,
  NOT_READY = 0x03,
  BUSY = 0x04,
  TIMEOUT = 0x05
}

export interface UsbPacket {
  opcode: UsbOpcode;
  length: number;
  data: Buffer;
  checksum: number;
}

export interface UsbEndpoints {
  in: usb.InEndpoint;
  out: usb.OutEndpoint;
  interrupt: usb.InEndpoint;
}

export class UsbProtocolHandler extends EventEmitter {
  private device: usb.Device;
  private endpoints: UsbEndpoints | null = null;
  private sequenceNumber = 0;
  private logger: UsbLogger | null = null;
  private pendingCommands = new Map<number, { 
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(device: usb.Device, logDir?: string) {
    super();
    this.device = device;
    if (logDir) {
      this.logger = new UsbLogger(logDir);
    }
  }

  public async initialize(): Promise<void> {
    try {
      // Start logging if enabled
      if (this.logger) {
        this.logger.start();
      }
      await this.setupEndpoints();
      await this.startListening();
      await this.sendInit();
      debug('USB protocol handler initialized');
    } catch (error) {
      debug('Failed to initialize USB protocol handler:', error);
      throw error;
    }
  }

  private async setupEndpoints(): Promise<void> {
    if (!this.device) throw new Error('No device available');

    try {
      const iface = this.device.interface(0);
      await iface.claim();

      // Find the endpoints we need
      const endpoints = {
        in: iface.endpoint(0x81) as usb.InEndpoint,
        out: iface.endpoint(0x01) as usb.OutEndpoint,
        interrupt: iface.endpoint(0x82) as usb.InEndpoint
      };

      // Configure endpoints
      endpoints.in.on('error', (error) => this.handleEndpointError('IN', error));
      endpoints.out.on('error', (error) => this.handleEndpointError('OUT', error));
      endpoints.interrupt.on('error', (error) => this.handleEndpointError('INT', error));

      this.endpoints = endpoints;
      debug('USB endpoints configured');
    } catch (error) {
      debug('Failed to setup USB endpoints:', error);
      throw error;
    }
  }

  private async startListening(): Promise<void> {
    if (!this.endpoints) throw new Error('Endpoints not configured');

    // Start listening for responses
    this.endpoints.in.startPoll();
    this.endpoints.in.on('data', (data) => this.handleIncomingData(data));

    // Start listening for interrupts
    this.endpoints.interrupt.startPoll();
    this.endpoints.interrupt.on('data', (data) => this.handleInterrupt(data));

    debug('USB listeners started');
  }

  private async sendInit(): Promise<void> {
    const packet = this.createPacket(UsbOpcode.INIT, Buffer.alloc(0));
    const response = await this.sendPacket(packet);
    
    if (response[0] !== UsbResponse.OK) {
      throw new Error(`Device initialization failed: ${response[0]}`);
    }
  }

  public async sendCommand(opcode: UsbOpcode, data: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    const packet = this.createPacket(opcode, data);
    return this.sendPacket(packet);
  }

  private createPacket(opcode: UsbOpcode, data: Buffer): UsbPacket {
    const length = data.length;
    const packet: UsbPacket = {
      opcode,
      length,
      data,
      checksum: this.calculateChecksum(opcode, length, data)
    };

    return packet;
  }

  private calculateChecksum(opcode: number, length: number, data: Buffer): number {
    let sum = opcode + length;
    for (const byte of data) {
      sum = (sum + byte) & 0xFF;
    }
    return (~sum + 1) & 0xFF; // Two's complement
  }

  private async sendPacket(packet: UsbPacket): Promise<Buffer> {
    if (!this.endpoints) throw new Error('Endpoints not configured');

    return new Promise((resolve, reject) => {
      const seq = this.sequenceNumber++;
      const header = Buffer.alloc(4);
      header.writeUInt8(packet.opcode, 0);
      header.writeUInt16LE(packet.length, 1);
      header.writeUInt8(packet.checksum, 3);

      const data = Buffer.concat([header, packet.data]);

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(seq);
        reject(new Error('Command timeout'));
      }, USB_TIMEOUT);

      // Store the promise handlers
      this.pendingCommands.set(seq, { resolve, reject, timeout });

      // Log outgoing packet
      if (this.logger) {
        this.logger.logPacket(PacketDirection.OUT, data);
      }

      // Send the packet
      this.endpoints.out.transfer(data, (error) => {
        if (error) {
          this.pendingCommands.delete(seq);
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private handleIncomingData(data: Buffer): void {
    try {
      // Log incoming packet
      if (this.logger) {
        this.logger.logPacket(PacketDirection.IN, data);
      }
      const seq = data.readUInt8(0);
      const status = data.readUInt8(1);
      const length = data.readUInt16LE(2);
      const payload = data.slice(4, 4 + length);

      const pending = this.pendingCommands.get(seq);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(seq);

        if (status === UsbResponse.OK) {
          pending.resolve(payload);
        } else {
          pending.reject(new Error(`Command failed with status: ${status}`));
        }
      }
    } catch (error) {
      debug('Error handling incoming data:', error);
      this.emit('error', error);
    }
  }

  private handleInterrupt(data: Buffer): void {
    try {
      // Log interrupt packet
      if (this.logger) {
        this.logger.logPacket(PacketDirection.INTERRUPT, data);
      }
      const type = data.readUInt8(0);
      const payload = data.slice(1);
      this.emit('interrupt', { type, payload });
    } catch (error) {
      debug('Error handling interrupt:', error);
      this.emit('error', error);
    }
  }

  private handleEndpointError(endpoint: string, error: Error): void {
    debug(`Error on ${endpoint} endpoint:`, error);
    this.emit('error', error);

    // Attempt recovery
    this.attemptRecovery(endpoint).catch((recoveryError) => {
      debug(`Recovery failed for ${endpoint}:`, recoveryError);
      this.emit('error', recoveryError);
    });
  }

  private async attemptRecovery(endpoint: string): Promise<void> {
    try {
      // Reset the problematic endpoint
      if (!this.endpoints) return;

      switch (endpoint) {
        case 'IN':
          await this.endpoints.in.clearHalt();
          this.endpoints.in.startPoll();
          break;
        case 'OUT':
          await this.endpoints.out.clearHalt();
          break;
        case 'INT':
          await this.endpoints.interrupt.clearHalt();
          this.endpoints.interrupt.startPoll();
          break;
      }

      debug(`Recovery successful for ${endpoint} endpoint`);
    } catch (error) {
      debug(`Recovery failed for ${endpoint} endpoint:`, error);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    if (!this.endpoints) return;

    try {
      // Stop logging
      if (this.logger) {
        this.logger.stop();
      }
      // Stop polling
      this.endpoints.in.stopPoll();
      this.endpoints.interrupt.stopPoll();

      // Clear any pending commands
      for (const [seq, { timeout }] of this.pendingCommands) {
        clearTimeout(timeout);
        this.pendingCommands.delete(seq);
      }

      debug('USB protocol handler cleaned up');
    } catch (error) {
      debug('Error during cleanup:', error);
      throw error;
    }
  }
}