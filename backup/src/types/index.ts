// Plugin types
export interface PluginConfig {
  [key: string]: any;
}

export interface Plugin {
  name: string;
  version: string;
  display?: PluginDisplay;
  actions: PluginActions;
  initialize?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface PluginDisplay {
  type: 'text' | 'image';
  content: string;
}

export interface PluginActions {
  onPress?: () => void;
  onRotate?: (direction: 'clockwise' | 'counterclockwise') => void;
  onTouch?: (x: number, y: number) => void;
}

// Device types
export interface DeviceState {
  connected: boolean;
  batteryLevel?: number;
  screen?: {
    width: number;
    height: number;
  };
}

// Server types
export interface ServerConfig {
  port: number;
  host: string;
  pluginDir: string;
}

// Events
export type DeviceEvent = 
  | { type: 'BUTTON_PRESS'; buttonId: string }
  | { type: 'DIAL_ROTATE'; direction: 'clockwise' | 'counterclockwise' }
  | { type: 'TOUCH'; x: number; y: number }
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT' };