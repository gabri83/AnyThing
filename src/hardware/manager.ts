import { EventEmitter } from 'events';
import * as HID from 'node-hid';
import * as usb from 'usb';
import { createCanvas } from 'canvas';
import {
  HardwareConfig,
  DeviceInfo,
  HardwareEvent,
  DisplayCommand,
  ButtonId,
  ButtonState,
  DialDirection,
  TouchState,
  Point,
  Rectangle
} from './types';

const CARTHING_VID = 0x2786; // Spotify Vendor ID
const CARTHING_PID = 0x1020; // CarThing Product ID

const DEFAULT_CONFIG: HardwareConfig = {
  displayInterface: 0,
  hidInterface: 1,
  audioInterface: 2,
  displayWidth: 480,
  displayHeight: 800,
  brightness: 100
};

export class HardwareManager extends EventEmitter {
  private device: usb.Device | null = null;
  private hidDevice: HID.HID | null = null;
  private config: HardwareConfig;
  private canvas: any; // Canvas for frame buffer
  private ctx: any; // Canvas 2D context
  private frameBuffer: Uint16Array;

  constructor(config: Partial<HardwareConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeFrameBuffer();
  }

  private initializeFrameBuffer(): void {
    this.canvas = createCanvas(this.config.displayWidth, this.config.displayHeight);
    this.ctx = this.canvas.getContext('2d');
    this.frameBuffer = new Uint16Array(this.config.displayWidth * this.config.displayHeight);
  }

  public async initialize(): Promise<boolean> {
    try {
      // Find and open the CarThing device
      const devices = usb.getDeviceList();
      this.device = devices.find(
        d => d.deviceDescriptor.idVendor === CARTHING_VID && 
             d.deviceDescriptor.idProduct === CARTHING_PID
      ) || null;

      if (!this.device) {
        throw new Error('CarThing device not found');
      }

      // Open the device
      this.device.open();

      // Initialize HID interface for controls
      const hidDevices = HID.devices();
      const hidDevice = hidDevices.find(
        d => d.vendorId === CARTHING_VID && 
             d.productId === CARTHING_PID &&
             d.interface === this.config.hidInterface
      );

      if (!hidDevice || !hidDevice.path) {
        throw new Error('CarThing HID interface not found');
      }

      this.hidDevice = new HID.HID(hidDevice.path);
      this.setupHIDListeners();

      // Initialize interfaces
      await this.initializeInterfaces();
      
      // Reset display and set initial state
      await this.resetDisplay();
      await this.setBrightness(this.config.brightness);

      return true;
    } catch (error) {
      console.error('Failed to initialize hardware:', error);
      this.cleanup();
      return false;
    }
  }

  private setupHIDListeners(): void {
    if (!this.hidDevice) return;

    this.hidDevice.on('data', (data: Buffer) => {
      const reportId = data[0];
      
      switch (reportId) {
        case 0x01: // Button Event
          this.handleButtonEvent(data);
          break;
        case 0x02: // Dial Event
          this.handleDialEvent(data);
          break;
        case 0x03: // Touch Event
          this.handleTouchEvent(data);
          break;
      }
    });

    this.hidDevice.on('error', (error: Error) => {
      console.error('HID device error:', error);
      this.emit('error', error);
    });
  }

  private handleButtonEvent(data: Buffer): void {
    const buttonId = data[1] as ButtonId;
    const state = data[2] as ButtonState;
    
    const event: HardwareEvent = {
      type: 'button',
      button: buttonId,
      state
    };

    this.emit('event', event);
  }

  private handleDialEvent(data: Buffer): void {
    const direction = data[1] as DialDirection;
    const steps = data[2];
    
    const event: HardwareEvent = {
      type: 'dial',
      direction,
      steps
    };

    this.emit('event', event);
  }

  private handleTouchEvent(data: Buffer): void {
    const x = data.readUInt16LE(1);
    const y = data.readUInt16LE(3);
    const state = data[5] as TouchState;
    
    const event: HardwareEvent = {
      type: 'touch',
      position: { x, y },
      state
    };

    this.emit('event', event);
  }

  private async initializeInterfaces(): Promise<void> {
    if (!this.device) return;

    try {
      // Claim interfaces
      const interfaces = this.device.interfaces;
      
      // Claim display interface
      const displayInterface = interfaces[this.config.displayInterface];
      displayInterface.claim();

      // Claim audio interface if needed
      const audioInterface = interfaces[this.config.audioInterface];
      audioInterface.claim();

    } catch (error) {
      console.error('Failed to initialize interfaces:', error);
      throw error;
    }
  }

  public async updateDisplay(region: Rectangle, imageData: ImageData): Promise<void> {
    if (!this.device) return;

    try {
      // Convert ImageData to RGB565
      const rgb565Data = this.convertToRGB565(imageData);
      
      // Prepare update command
      const command = {
        command: DisplayCommand.PARTIAL_UPDATE,
        region,
        pixels: rgb565Data
      };

      // Send to device
      await this.sendDisplayCommand(command);
    } catch (error) {
      console.error('Failed to update display:', error);
      throw error;
    }
  }

  private convertToRGB565(imageData: ImageData): Uint16Array {
    const { data } = imageData;
    const rgb565 = new Uint16Array(data.length / 4);

    for (let i = 0; i < data.length; i += 4) {
      const r = (data[i] >> 3) & 0x1F;
      const g = (data[i + 1] >> 2) & 0x3F;
      const b = (data[i + 2] >> 3) & 0x1F;

      rgb565[i / 4] = (r << 11) | (g << 5) | b;
    }

    return rgb565;
  }

  private async sendDisplayCommand(command: DisplayCommand): Promise<void> {
    if (!this.device) return;

    // Implementation will depend on reverse-engineered protocol
    // This is a placeholder for the actual implementation
    console.log('Sending display command:', command);
  }

  public async resetDisplay(): Promise<void> {
    if (!this.device) return;

    const command = {
      command: DisplayCommand.DISPLAY_CONTROL,
      control: DisplayCommand.RESET
    };

    await this.sendDisplayCommand(command);
  }

  public async setBrightness(level: number): Promise<void> {
    if (!this.device) return;

    const normalizedLevel = Math.max(0, Math.min(100, Math.round(level)));
    const command = {
      command: DisplayCommand.BRIGHTNESS,
      level: normalizedLevel
    };

    await this.sendDisplayCommand(command);
    this.config.brightness = normalizedLevel;
  }

  public async cleanup(): Promise<void> {
    try {
      if (this.hidDevice) {
        this.hidDevice.close();
        this.hidDevice = null;
      }

      if (this.device) {
        this.device.close();
        this.device = null;
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  public getDeviceInfo(): DeviceInfo | null {
    if (!this.device) return null;

    return {
      vendorId: CARTHING_VID,
      productId: CARTHING_PID,
      // Additional info would be populated from device descriptors
    };
  }
}