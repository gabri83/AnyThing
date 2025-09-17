import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import Debug from 'debug';
import { PacketDirection, PacketLog } from './logger';

const debug = Debug('anything:usb:analyzer');

export interface PacketPattern {
  name: string;
  description: string;
  matcher: (data: Buffer) => boolean;
}

export interface PacketAnalysis {
  totalPackets: number;
  byDirection: Record<PacketDirection, number>;
  bytesTransferred: number;
  averagePacketSize: number;
  errors: number;
  patterns: Array<{
    pattern: string;
    count: number;
    description: string;
  }>;
  timingAnalysis: {
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
  };
}

export interface TimingData {
  command: number;
  response: number;
  delta: number;
}

export class UsbPacketAnalyzer {
  private patterns: PacketPattern[] = [
    {
      name: 'INIT_SEQUENCE',
      description: 'Device initialization sequence',
      matcher: (data: Buffer) => data[0] === 0x01 && data.length >= 4
    },
    {
      name: 'DISPLAY_UPDATE',
      description: 'Display update command',
      matcher: (data: Buffer) => data[0] === 0x11 || data[0] === 0x12
    },
    {
      name: 'CONTROL_COMMAND',
      description: 'Device control command',
      matcher: (data: Buffer) => data[0] >= 0x01 && data[0] <= 0x04
    },
    {
      name: 'ERROR_RESPONSE',
      description: 'Error response from device',
      matcher: (data: Buffer) => data[0] === 0xFF
    }
  ];

  public async analyzeLogFile(filePath: string): Promise<PacketAnalysis> {
    const analysis: PacketAnalysis = {
      totalPackets: 0,
      byDirection: {
        [PacketDirection.IN]: 0,
        [PacketDirection.OUT]: 0,
        [PacketDirection.INTERRUPT]: 0
      },
      bytesTransferred: 0,
      averagePacketSize: 0,
      errors: 0,
      patterns: [],
      timingAnalysis: {
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity
      }
    };

    const timings: TimingData[] = [];
    let lastOutgoingTime = 0;

    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let currentPacket: Partial<PacketLog> = {};
      let isCollectingPacket = false;

      for await (const line of rl) {
        if (line.startsWith('[')) {
          // New packet entry
          if (isCollectingPacket) {
            this.processPacket(currentPacket as PacketLog, analysis, timings);
          }
          currentPacket = this.parsePacketHeader(line);
          isCollectingPacket = true;
        } else if (line.startsWith('HEX:')) {
          currentPacket.data = this.parseHexData(line);
        } else if (line.startsWith('ERROR:')) {
          analysis.errors++;
        }
      }

      // Process last packet
      if (isCollectingPacket) {
        this.processPacket(currentPacket as PacketLog, analysis, timings);
      }

      // Calculate timing statistics
      if (timings.length > 0) {
        analysis.timingAnalysis = this.calculateTimingStatistics(timings);
      }

      // Calculate averages
      analysis.averagePacketSize = analysis.bytesTransferred / analysis.totalPackets;

      // Analyze patterns
      analysis.patterns = this.analyzePatterns(analysis);

      debug('Analysis completed:', analysis);
      return analysis;

    } catch (error) {
      debug('Error analyzing log file:', error);
      throw error;
    }
  }

  private parsePacketHeader(line: string): Partial<PacketLog> {
    const matches = line.match(/\[(\d+)ms\] (IN|OUT|INT)/);
    if (!matches) return {};

    return {
      timestamp: parseInt(matches[1], 10),
      direction: matches[2] as PacketDirection
    };
  }

  private parseHexData(line: string): Buffer {
    const hexString = line.replace('HEX:', '').trim();
    const bytes = hexString.split(' ').map(hex => parseInt(hex, 16));
    return Buffer.from(bytes);
  }

  private processPacket(packet: PacketLog, analysis: PacketAnalysis, timings: TimingData[]): void {
    analysis.totalPackets++;
    analysis.byDirection[packet.direction]++;
    analysis.bytesTransferred += packet.data.length;

    // Track timing for request-response pairs
    if (packet.direction === PacketDirection.OUT) {
      timings.push({
        command: packet.timestamp,
        response: 0,
        delta: 0
      });
    } else if (packet.direction === PacketDirection.IN && timings.length > 0) {
      const lastTiming = timings[timings.length - 1];
      if (!lastTiming.response) {
        lastTiming.response = packet.timestamp;
        lastTiming.delta = packet.timestamp - lastTiming.command;
      }
    }
  }

  private calculateTimingStatistics(timings: TimingData[]): {
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
  } {
    const validTimings = timings.filter(t => t.delta > 0);
    if (validTimings.length === 0) {
      return {
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: 0
      };
    }

    const deltas = validTimings.map(t => t.delta);
    return {
      averageResponseTime: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      maxResponseTime: Math.max(...deltas),
      minResponseTime: Math.min(...deltas)
    };
  }

  private analyzePatterns(analysis: PacketAnalysis): Array<{
    pattern: string;
    count: number;
    description: string;
  }> {
    const patternCounts = new Map<string, number>();

    this.patterns.forEach(pattern => {
      patternCounts.set(pattern.name, 0);
    });

    // Count pattern occurrences
    // This would be populated with actual packet data in a real implementation

    return Array.from(patternCounts.entries()).map(([pattern, count]) => {
      const patternInfo = this.patterns.find(p => p.name === pattern);
      return {
        pattern,
        count,
        description: patternInfo?.description || ''
      };
    });
  }

  public addPattern(pattern: PacketPattern): void {
    this.patterns.push(pattern);
  }

  public removePattern(name: string): void {
    this.patterns = this.patterns.filter(p => p.name !== name);
  }
}