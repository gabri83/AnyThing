import { UsbProtocolHandler } from '../protocol';
import { DisplayProtocol } from '../display';
import { UsbConnectionManager, ConnectionState } from '../connection';
import { UsbPacketAnalyzer } from '../analyzer';
import { PacketDirection } from '../logger';
import * as usb from 'usb';

// Mock USB device for testing
const mockDevice = {
  deviceDescriptor: {
    idVendor: 0x2786,
    idProduct: 0x1020
  },
  interface: () => ({
    claim: jest.fn(),
    endpoint: (addr: number) => ({
      transfer: jest.fn(),
      on: jest.fn(),
      startPoll: jest.fn(),
      stopPoll: jest.fn(),
      clearHalt: jest.fn()
    })
  })
} as unknown as usb.Device;

describe('USB Protocol Handler', () => {
  let protocol: UsbProtocolHandler;

  beforeEach(() => {
    protocol = new UsbProtocolHandler(mockDevice, '/tmp/logs');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('initialization sequence', async () => {
    await expect(protocol.initialize()).resolves.not.toThrow();
  });

  test('command sending and receiving', async () => {
    await protocol.initialize();
    const data = Buffer.from([0x01, 0x02, 0x03]);
    await expect(protocol.sendCommand(0x01, data)).resolves.not.toThrow();
  });

  test('error handling and recovery', async () => {
    const error = new Error('USB error');
    jest.spyOn(mockDevice, 'interface').mockImplementationOnce(() => {
      throw error;
    });

    await expect(protocol.initialize()).rejects.toThrow('USB error');
  });
});

describe('Display Protocol', () => {
  let protocol: UsbProtocolHandler;
  let display: DisplayProtocol;

  beforeEach(() => {
    protocol = new UsbProtocolHandler(mockDevice, '/tmp/logs');
    display = new DisplayProtocol(protocol);
  });

  test('display initialization', async () => {
    await expect(display.initialize()).resolves.not.toThrow();
  });

  test('full screen update', async () => {
    await display.initialize();
    const imageData = new Uint16Array(480 * 800);
    await expect(display.updateFull(imageData)).resolves.not.toThrow();
  });

  test('partial screen update', async () => {
    await display.initialize();
    const region = { x: 0, y: 0, width: 100, height: 100 };
    const imageData = new Uint16Array(100 * 100);
    await expect(display.updatePartial(region, imageData)).resolves.not.toThrow();
  });
});

describe('USB Connection Manager', () => {
  let manager: UsbConnectionManager;

  beforeEach(() => {
    manager = new UsbConnectionManager({
      vendorId: 0x2786,
      productId: 0x1020,
      maxRetries: 3,
      retryDelay: 100,
      logDir: '/tmp/logs'
    });
  });

  test('connection state transitions', async () => {
    expect(manager.getState()).toBe(ConnectionState.DISCONNECTED);
    
    await manager.connect();
    expect(manager.getState()).toBe(ConnectionState.CONNECTED);
    
    await manager.disconnect();
    expect(manager.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  test('automatic reconnection', async () => {
    const mockConnect = jest.spyOn(manager, 'connect');
    await manager.connect();
    
    // Simulate device disconnection
    await manager['handleDeviceDetached']();
    
    // Wait for reconnection attempts
    await new Promise(resolve => setTimeout(resolve, 500));
    
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  test('error recovery', async () => {
    const error = new Error('Connection lost');
    await manager.connect();
    
    await manager['handleError'](error);
    expect(manager.getState()).toBe(ConnectionState.RECOVERING);
  });
});

describe('USB Packet Analyzer', () => {
  let analyzer: UsbPacketAnalyzer;

  beforeEach(() => {
    analyzer = new UsbPacketAnalyzer();
  });

  test('packet pattern matching', () => {
    const initPacket = Buffer.from([0x01, 0x00, 0x00, 0x00]);
    const displayPacket = Buffer.from([0x11, 0x00, 0x00]);
    const errorPacket = Buffer.from([0xFF]);

    const patterns = analyzer['patterns'];
    
    expect(patterns.find(p => p.name === 'INIT_SEQUENCE')?.matcher(initPacket)).toBe(true);
    expect(patterns.find(p => p.name === 'DISPLAY_UPDATE')?.matcher(displayPacket)).toBe(true);
    expect(patterns.find(p => p.name === 'ERROR_RESPONSE')?.matcher(errorPacket)).toBe(true);
  });

  test('custom pattern registration', () => {
    const customPattern = {
      name: 'CUSTOM',
      description: 'Custom pattern',
      matcher: (data: Buffer) => data[0] === 0xAA
    };

    analyzer.addPattern(customPattern);
    expect(analyzer['patterns']).toContainEqual(customPattern);

    analyzer.removePattern('CUSTOM');
    expect(analyzer['patterns']).not.toContainEqual(customPattern);
  });

  test('timing analysis', () => {
    const mockTimings = [
      { command: 0, response: 10, delta: 10 },
      { command: 20, response: 35, delta: 15 },
      { command: 40, response: 50, delta: 10 }
    ];

    const stats = analyzer['calculateTimingStatistics'](mockTimings);
    
    expect(stats.averageResponseTime).toBe((10 + 15 + 10) / 3);
    expect(stats.maxResponseTime).toBe(15);
    expect(stats.minResponseTime).toBe(10);
  });
});