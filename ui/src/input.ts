import { useEffect, useRef } from 'react';
import {
  actionForGesture,
  gestureForKey,
  type ControlBindings,
  type InputConfig,
  type InputGesture
} from '@anything/shared';

/** A raw browser event and what it resolved to. Feeds the input inspector. */
export interface RawInputEvent {
  source: 'key' | 'wheel';
  /** KeyboardEvent.key, or the wheel delta rendered as text. */
  detail: string;
  /** KeyboardEvent.code, when there was one. */
  code?: string;
  gesture: InputGesture | null;
  /** The action it invoked, if the active page binds that gesture. */
  action?: string;
  at: number;
}

export interface DeviceInputOptions {
  input: InputConfig | null;
  /** Bindings of the page currently on screen. */
  bindings: ControlBindings | undefined;
  invoke: (action: string, payload?: unknown) => void;
  /** Called for every mapped or unmapped event, for the inspector. */
  onRaw?: (event: RawInputEvent) => void;
  /** When true, events are reported but never invoked. */
  inspectOnly?: boolean;
}

/**
 * Turn the device's physical controls into plugin actions.
 *
 * Rotation is accumulated rather than forwarded per click. A dial emits a burst
 * of steps, and each step on the music page is an AppleScript round trip; batching
 * a spin into one call with a summed delta is the difference between the volume
 * tracking your hand and trailing a second behind it.
 */
export function useDeviceInput({
  input,
  bindings,
  invoke,
  onRaw,
  inspectOnly = false
}: DeviceInputOptions): void {
  // Held in refs so the window listeners are attached once and always read
  // current values, rather than being torn down on every tile update.
  const stateRef = useRef({ input, bindings, invoke, onRaw, inspectOnly });
  stateRef.current = { input, bindings, invoke, onRaw, inspectOnly };

  const pendingRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      flushTimerRef.current = null;
      const delta = pendingRef.current;
      pendingRef.current = 0;
      if (delta === 0) return;

      const { bindings: current, invoke: send, inspectOnly: quiet } = stateRef.current;
      const action = current?.rotate;
      if (action && !quiet) send(action, { delta });
    };

    const scheduleFlush = () => {
      const { input: config } = stateRef.current;
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flush, config?.rotateFlushMs ?? 80);
    };

    /** Record a gesture, returning the action it would invoke. */
    const dispatch = (gesture: InputGesture | null): string | undefined => {
      if (!gesture) return undefined;
      const { bindings: current, invoke: send, inspectOnly: quiet } = stateRef.current;

      if (gesture === 'rotate-cw' || gesture === 'rotate-ccw') {
        pendingRef.current += gesture === 'rotate-cw' ? 1 : -1;
        scheduleFlush();
        return current?.rotate;
      }

      const action = actionForGesture(current, gesture);
      if (action && !quiet) send(action);
      return action;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const { input: config, onRaw: report } = stateRef.current;
      if (!config) return;

      // Never steal keys from a real keyboard user mid-input.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const gesture = gestureForKey(config, event.key, event.code);

      // A held key repeats, which is what a dial spun and held looks like;
      // a button, though, must not fire on every repeat.
      if (event.repeat && gesture !== 'rotate-cw' && gesture !== 'rotate-ccw') {
        return;
      }

      const action = dispatch(gesture);
      report?.({
        source: 'key',
        detail: event.key === ' ' ? 'Space' : event.key,
        code: event.code,
        gesture,
        action,
        at: Date.now()
      });

      // Arrow keys would otherwise scroll the page out from under the grid.
      if (gesture) event.preventDefault();
    };

    const onWheel = (event: WheelEvent) => {
      const { input: config, onRaw: report } = stateRef.current;
      if (!config?.wheel || event.deltaY === 0) return;

      const direction = Math.sign(event.deltaY) * (config.wheelInvert ? -1 : 1);
      const gesture: InputGesture = direction > 0 ? 'rotate-cw' : 'rotate-ccw';

      const action = dispatch(gesture);
      report?.({
        source: 'wheel',
        detail: `deltaY ${event.deltaY > 0 ? '+' : ''}${Math.round(event.deltaY)}`,
        gesture,
        action,
        at: Date.now()
      });
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    };
  }, []);
}
