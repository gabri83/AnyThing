import { UsbProtocolHandler, UsbOpcode } from './protocol';
import Debug from 'debug';

const debug = Debug('anything:usb:display');

// Display-specific constants
const DISPLAY_WIDTH = 480;
const DISPLAY_HEIGHT = 800;
const BYTES_PER_PIXEL = 2; // RGB565 format
const MAX_CHUNK_SIZE = 1024; // Maximum bytes per USB transfer

export enum DisplayPowerState {
  OFF = 0x00,
  ON = 0x01,
  SLEEP = 0x02
}

export interface DisplayRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class DisplayProtocol {
  private protocol: UsbProtocolHandler;
  private initialized: boolean = false;
  private powerState: DisplayPowerState = DisplayPowerState.OFF;

  constructor(protocol: UsbProtocolHandler) {
    this.protocol = protocol;
  }

  public async initialize(): Promise<void> {
    try {
      // Send display initialization command
      const initData = Buffer.alloc(4);
      initData.writeUInt16LE(DISPLAY_WIDTH, 0);
      initData.writeUInt16LE(DISPLAY_HEIGHT, 2);

      await this.protocol.sendCommand(UsbOpcode.DISPLAY_INIT, initData);
      this.initialized = true;
      this.powerState = DisplayPowerState.ON;
      debug('Display initialized');
    } catch (error) {
      debug('Failed to initialize display:', error);
      throw error;
    }
  }

  public async updateFull(imageData: Uint16Array): Promise<void> {
    if (!this.initialized) throw new Error('Display not initialized');
    if (imageData.length !== DISPLAY_WIDTH * DISPLAY_HEIGHT) {
      throw new Error('Invalid image data size');
    }

    try {
      // Send full update command with chunks
      const totalBytes = imageData.length * BYTES_PER_PIXEL;
      const chunks = Math.ceil(totalBytes / MAX_CHUNK_SIZE);

      for (let i = 0; i < chunks; i++) {
        const start = i * MAX_CHUNK_SIZE / BYTES_PER_PIXEL;
        const end = Math.min(start + MAX_CHUNK_SIZE / BYTES_PER_PIXEL, imageData.length);
        const chunk = imageData.slice(start, end);

        const chunkHeader = Buffer.alloc(8);
        chunkHeader.writeUInt16LE(i, 0); // Chunk index
        chunkHeader.writeUInt16LE(chunks, 2); // Total chunks
        chunkHeader.writeUInt16LE(chunk.length, 4); // Chunk size in pixels
        chunkHeader.writeUInt16LE(start, 6); // Start offset in pixels

        const chunkData = Buffer.concat([
          chunkHeader,
          Buffer.from(chunk.buffer)
        ]);

        await this.protocol.sendCommand(UsbOpcode.DISPLAY_UPDATE, chunkData);
      }

      debug('Full display update completed');
    } catch (error) {
      debug('Failed to update display:', error);
      throw error;
    }
  }

  public async updatePartial(region: DisplayRegion, imageData: Uint16Array): Promise<void> {
    if (!this.initialized) throw new Error('Display not initialized');

    const expectedSize = region.width * region.height;
    if (imageData.length !== expectedSize) {
      throw new Error('Invalid image data size for region');
    }

    if (!this.isValidRegion(region)) {
      throw new Error('Invalid display region');
    }

    try {
      // Send partial update command with region info
      const regionHeader = Buffer.alloc(8);
      regionHeader.writeUInt16LE(region.x, 0);
      regionHeader.writeUInt16LE(region.y, 2);
      regionHeader.writeUInt16LE(region.width, 4);
      regionHeader.writeUInt16LE(region.height, 6);

      const totalBytes = imageData.length * BYTES_PER_PIXEL;
      const chunks = Math.ceil(totalBytes / MAX_CHUNK_SIZE);

      for (let i = 0; i < chunks; i++) {
        const start = i * MAX_CHUNK_SIZE / BYTES_PER_PIXEL;
        const end = Math.min(start + MAX_CHUNK_SIZE / BYTES_PER_PIXEL, imageData.length);
        const chunk = imageData.slice(start, end);

        const chunkHeader = Buffer.alloc(4);
        chunkHeader.writeUInt16LE(i, 0); // Chunk index
        chunkHeader.writeUInt16LE(chunks, 2); // Total chunks

        const chunkData = Buffer.concat([
          regionHeader,
          chunkHeader,
          Buffer.from(chunk.buffer)
        ]);

        await this.protocol.sendCommand(UsbOpcode.DISPLAY_PARTIAL, chunkData);
      }

      debug('Partial display update completed');
    } catch (error) {
      debug('Failed to update display region:', error);
      throw error;
    }
  }

  public async setPower(state: DisplayPowerState): Promise<void> {
    try {
      const data = Buffer.alloc(1);
      data.writeUInt8(state, 0);
      await this.protocol.sendCommand(UsbOpcode.DISPLAY_POWER, data);
      this.powerState = state;
      debug(`Display power state set to: ${state}`);
    } catch (error) {
      debug('Failed to set display power state:', error);
      throw error;
    }
  }

  public async setBrightness(level: number): Promise<void> {
    if (level < 0 || level > 100) {
      throw new Error('Brightness level must be between 0 and 100');
    }

    try {
      const data = Buffer.alloc(1);
      data.writeUInt8(level, 0);
      await this.protocol.sendCommand(UsbOpcode.SET_BRIGHTNESS, data);
      debug(`Display brightness set to: ${level}`);
    } catch (error) {
      debug('Failed to set display brightness:', error);
      throw error;
    }
  }

  private isValidRegion(region: DisplayRegion): boolean {
    return (
      region.x >= 0 &&
      region.y >= 0 &&
      region.width > 0 &&
      region.height > 0 &&
      region.x + region.width <= DISPLAY_WIDTH &&
      region.y + region.height <= DISPLAY_HEIGHT
    );
  }

  public getCurrentPowerState(): DisplayPowerState {
    return this.powerState;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getDisplayDimensions(): { width: number; height: number } {
    return {
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT
    };
  }
}