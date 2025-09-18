import { WriteStream, createWriteStream } from 'fs';
import { join } from 'path';
import Debug from 'debug';

const debug = Debug('anything:usb:logger');

export enum PacketDirection {
  IN = 'IN',
  OUT = 'OUT',
  INTERRUPT = 'INT'
}

export interface PacketLog {
  timestamp: number;
  direction: PacketDirection;
  data: Buffer;
  error?: Error;
}

export class UsbLogger {
  private logStream: WriteStream | null = null;
  private enabled: boolean = false;
  private sessionStartTime: number;

  constructor(private logDir: string) {
    this.sessionStartTime = Date.now();
  }

  public start(): void {
    if (this.enabled) return;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = join(this.logDir, `usb-${timestamp}.log`);
      this.logStream = createWriteStream(logFile, { flags: 'a' });
      this.enabled = true;
      
      this.logMetadata();
      debug(`USB logging started: ${logFile}`);
    } catch (error) {
      debug('Failed to start USB logging:', error);
      throw error;
    }
  }

  public stop(): void {
    if (!this.enabled || !this.logStream) return;

    try {
      this.logStream.end();
      this.logStream = null;
      this.enabled = false;
      debug('USB logging stopped');
    } catch (error) {
      debug('Error stopping USB logger:', error);
      throw error;
    }
  }

  public logPacket(direction: PacketDirection, data: Buffer, error?: Error): void {
    if (!this.enabled || !this.logStream) return;

    const log: PacketLog = {
      timestamp: Date.now() - this.sessionStartTime,
      direction,
      data,
      error
    };

    try {
      // Format packet data
      const hexData = data.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
      const asciiData = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
      
      // Create log entry
      let entry = `[${log.timestamp}ms] ${direction} `;
      entry += `[${data.length} bytes]\n`;
      entry += `HEX: ${hexData}\n`;
      entry += `ASCII: ${asciiData}\n`;

      if (error) {
        entry += `ERROR: ${error.message}\n`;
        if (error.stack) {
          entry += `STACK: ${error.stack}\n`;
        }
      }

      entry += '---\n';

      // Write to log file
      this.logStream.write(entry);
    } catch (error) {
      debug('Error logging USB packet:', error);
    }
  }

  private logMetadata(): void {
    if (!this.enabled || !this.logStream) return;

    const metadata = {
      timestamp: new Date().toISOString(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    };

    const entry = `=== USB Packet Log ===\n${JSON.stringify(metadata, null, 2)}\n---\n`;
    this.logStream.write(entry);
  }

  public async analyze(logFile: string): Promise<{
    totalPackets: number;
    byDirection: Record<PacketDirection, number>;
    averageSize: number;
    errors: number;
    commonPatterns: Array<{ pattern: string; count: number }>;
  }> {
    // This is a placeholder for log analysis functionality
    // TODO: Implement log analysis
    return {
      totalPackets: 0,
      byDirection: {
        [PacketDirection.IN]: 0,
        [PacketDirection.OUT]: 0,
        [PacketDirection.INTERRUPT]: 0
      },
      averageSize: 0,
      errors: 0,
      commonPatterns: []
    };
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}