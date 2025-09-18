// Basic message structure - our own simple protocol
export type MessageType = 'command' | 'event' | 'state';

export interface Message {
  type: MessageType;
  target?: string;  // For commands: which component should handle it
  data: any;        // Actual payload
}

// Music-specific types
export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  artwork?: string;
}

export interface PlayerState {
  status: 'playing' | 'paused' | 'stopped';
  track: TrackInfo | null;
}

// Music commands
export type MusicCommand = 
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'seek'; position: number };

// Actual message types
export interface MusicCommandMessage extends Message {
  type: 'command';
  target: 'music';
  data: MusicCommand;
}

export interface MusicStateMessage extends Message {
  type: 'state';
  target: 'music';
  data: PlayerState;
}

// Simple connection messages
export interface ConnectionMessage extends Message {
  type: 'command';
  target: 'system';
  data: {
    action: 'connect';
    client: string;
  };
}
