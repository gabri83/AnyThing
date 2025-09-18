// Mock USB module
jest.mock('usb', () => ({
  __esModule: true,
  default: {
    getDeviceList: jest.fn(() => []),
    on: jest.fn(),
    findByIds: jest.fn()
  }
}));

// Mock file system for logging
jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn()
  })),
  createReadStream: jest.fn(() => ({
    pipe: jest.fn()
  }))
}));

// Mock debug module
jest.mock('debug', () => jest.fn(() => jest.fn()));

// Global test timeout
jest.setTimeout(10000);