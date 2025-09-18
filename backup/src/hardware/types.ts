export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum ButtonId {
  BACK = 0x01,
  PRESET_1 = 0x02,
  PRESET_2 = 0x03,
  PRESET_3 = 0x04,
  PRESET_4 = 0x05
}

export enum ButtonState {
  RELEASED = 0x00,
  PRESSED = 0x01
}

export enum DialDirection {
  CLOCKWISE = 0x00,
  COUNTERCLOCKWISE = 0x01
}

export enum TouchState {
  END = 0x00,
  START = 0x01,
  MOVE = 0x02
}

export enum DisplayCommand {
  FULL_UPDATE = 0x01,
  PARTIAL_UPDATE = 0x02,
  DISPLAY_CONTROL = 0x03,
  BRIGHTNESS = 0x04
}

export enum DisplayControl {
  SLEEP = 0x00,
  WAKE = 0x01,
  RESET = 0x02
}

export interface ButtonEvent {
  type: 'button';
  button: ButtonId;
  state: ButtonState;
}

export interface DialEvent {
  type: 'dial';
  direction: DialDirection;
  steps: number;
}

export interface TouchEvent {
  type: 'touch';
  position: Point;
  state: TouchState;
}

export type HardwareEvent = ButtonEvent | DialEvent | TouchEvent;

export interface DisplayUpdate {
  command: DisplayCommand.FULL_UPDATE | DisplayCommand.PARTIAL_UPDATE;
  region: Rectangle;
  pixels: Uint16Array; // RGB565 format
}

export interface DisplayControl {
  command: DisplayCommand.DISPLAY_CONTROL;
  control: DisplayControl;
}

export interface BrightnessControl {
  command: DisplayCommand.BRIGHTNESS;
  level: number; // 0-100
}

export type DisplayCommand = DisplayUpdate | DisplayControl | BrightnessControl;

export interface HardwareConfig {
  displayInterface: number;
  hidInterface: number;
  audioInterface: number;
  displayWidth: number;
  displayHeight: number;
  brightness: number;
}

export interface DeviceInfo {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
}