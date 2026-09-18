/**
 * Physical controls.
 *
 * The Car Thing has a rotary dial (which also presses), a back button and four
 * preset buttons. None of them reach a web page directly: the flashed image
 * decides what they emit, and different images emit different things. Some send
 * arrow keys, some send digits, some report the dial as mouse-wheel scrolling.
 *
 * So nothing here names a key. A plugin binds a *gesture* to one of its
 * actions, and a separately configurable keymap decides which raw browser event
 * counts as that gesture. That keeps the plugin correct whatever is on the
 * device, and makes an unknown device a config change rather than a code change.
 */

/** What the user did, independent of how the device reported it. */
export type InputGesture =
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'press'
  | 'back'
  | 'preset1'
  | 'preset2'
  | 'preset3'
  | 'preset4';

export const INPUT_GESTURES: InputGesture[] = [
  'rotate-cw',
  'rotate-ccw',
  'press',
  'back',
  'preset1',
  'preset2',
  'preset3',
  'preset4'
];

/**
 * A plugin's bindings from control to action id. Rotation is one binding for
 * both directions: the handler receives a signed step count, so a plugin
 * adjusting a value does not need two near-identical handlers.
 */
export interface ControlBindings {
  /** Invoked with `{ delta: number }` — signed dial steps, negative anticlockwise. */
  rotate?: string;
  /** Pressing the dial in. */
  press?: string;
  /** The back button. */
  back?: string;
  /** The four preset buttons along the top, in order. */
  presets?: Array<string | undefined>;
}

/** Payload delivered to a `rotate` handler. */
export interface RotatePayload {
  delta: number;
}

/** Reads a rotate payload, or null when it is not one. */
export function rotateDelta(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const delta = (payload as { delta?: unknown }).delta;
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    return null;
  }
  return delta;
}

/**
 * Which browser events count as which gesture.
 *
 * Keys are matched against `KeyboardEvent.key`, or against
 * `KeyboardEvent.code` when prefixed with `code:` — some images report keys
 * with no useful `key` value at all.
 */
export interface InputConfig {
  keymap: Record<string, InputGesture>;
  /** Treat mouse-wheel scrolling as dial rotation. */
  wheel: boolean;
  /**
   * Flip the wheel's direction. Which way a dial-as-wheel reports clockwise is
   * not knowable in advance, and unlike a key binding it cannot be fixed by
   * swapping two keymap entries — hence a flag.
   */
  wheelInvert: boolean;
  /**
   * Milliseconds to gather rotation before dispatching. A dial emits a burst of
   * steps; sending each one separately would mean an AppleScript call per click.
   */
  rotateFlushMs: number;
}

/**
 * Defaults covering what the common images are most likely to send. They are a
 * starting guess, not a promise: open the input inspector on the device to see
 * what yours actually emits.
 */
export const DEFAULT_INPUT_CONFIG: InputConfig = {
  keymap: {
    ArrowRight: 'rotate-cw',
    ArrowUp: 'rotate-cw',
    ArrowLeft: 'rotate-ccw',
    ArrowDown: 'rotate-ccw',
    Enter: 'press',
    ' ': 'press',
    Escape: 'back',
    Backspace: 'back',
    '1': 'preset1',
    '2': 'preset2',
    '3': 'preset3',
    '4': 'preset4'
  },
  wheel: true,
  wheelInvert: false,
  rotateFlushMs: 80
};

/** Resolve a keyboard event to a gesture, honouring the `code:` prefix. */
export function gestureForKey(
  config: InputConfig,
  key: string,
  code?: string
): InputGesture | null {
  const byKey = config.keymap[key];
  if (byKey) return byKey;
  if (code) {
    const byCode = config.keymap[`code:${code}`];
    if (byCode) return byCode;
  }
  return null;
}

/** The action a gesture should invoke under these bindings, if any. */
export function actionForGesture(
  bindings: ControlBindings | undefined,
  gesture: InputGesture
): string | undefined {
  if (!bindings) return undefined;
  switch (gesture) {
    case 'rotate-cw':
    case 'rotate-ccw':
      return bindings.rotate;
    case 'press':
      return bindings.press;
    case 'back':
      return bindings.back;
    case 'preset1':
      return bindings.presets?.[0];
    case 'preset2':
      return bindings.presets?.[1];
    case 'preset3':
      return bindings.presets?.[2];
    case 'preset4':
      return bindings.presets?.[3];
  }
}
