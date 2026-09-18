import { useEffect, useRef, useState } from 'react';
import { INPUT_GESTURES, type InputConfig, type InputGesture } from '@anything/shared';

export interface ControlsPanelProps {
  input: InputConfig;
  onChange: (input: InputConfig) => void;
}

const GESTURE_LABELS: Record<InputGesture, string> = {
  'rotate-cw': 'Dial clockwise',
  'rotate-ccw': 'Dial anticlockwise',
  press: 'Dial press',
  back: 'Back button',
  preset1: 'Preset 1',
  preset2: 'Preset 2',
  preset3: 'Preset 3',
  preset4: 'Preset 4'
};

export function ControlsPanel({ input, onChange }: ControlsPanelProps) {
  const [capturing, setCapturing] = useState<InputGesture | null>(null);
  const captureRef = useRef<InputGesture | null>(null);
  captureRef.current = capturing;

  // Capture mode: the next key pressed is bound to the gesture being learned.
  // Far less error-prone than asking someone to type "code:Numpad7" by hand.
  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const gesture = captureRef.current;
      if (!gesture) return;

      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }

      // Prefer `key`, but fall back to `code:` when the key is meaningless —
      // some device images report exactly that.
      const binding =
        event.key && event.key !== 'Unidentified' ? event.key : `code:${event.code}`;

      const keymap = { ...input.keymap };
      // One key means one gesture, so drop any previous use of it.
      delete keymap[binding];
      for (const [existing, mapped] of Object.entries(keymap)) {
        if (mapped === gesture) delete keymap[existing];
      }
      keymap[binding] = gesture;

      onChange({ ...input, keymap });
      setCapturing(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [capturing, input, onChange]);

  const keysFor = (gesture: InputGesture): string[] =>
    Object.entries(input.keymap)
      .filter(([, mapped]) => mapped === gesture)
      .map(([key]) => key);

  const unbind = (key: string) => {
    const keymap = { ...input.keymap };
    delete keymap[key];
    onChange({ ...input, keymap });
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Dial and buttons</h2>
          <p className="panel-sub">
            What your device sends depends on the image you flashed. Click Learn,
            then turn the dial or press the button.
          </p>
        </div>
      </header>

      <ul className="gesture-list">
        {INPUT_GESTURES.map((gesture) => (
          <li key={gesture} className="gesture" data-capturing={capturing === gesture || undefined}>
            <span className="gesture-name">{GESTURE_LABELS[gesture]}</span>

            <div className="gesture-keys">
              {keysFor(gesture).length === 0 ? (
                <span className="gesture-unbound">nothing bound</span>
              ) : (
                keysFor(gesture).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="key-chip"
                    title="Remove this binding"
                    onClick={() => unbind(key)}
                  >
                    <code>{key === ' ' ? 'Space' : key}</code>
                    <span aria-hidden>{'×'}</span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setCapturing(capturing === gesture ? null : gesture)}
            >
              {capturing === gesture ? 'Press a key (Esc to cancel)' : 'Learn'}
            </button>
          </li>
        ))}
      </ul>

      <div className="field-row">
        <label className="check">
          <input
            type="checkbox"
            checked={input.wheel}
            onChange={(event) => onChange({ ...input, wheel: event.target.checked })}
          />
          Treat scrolling as dial rotation
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={input.wheelInvert}
            disabled={!input.wheel}
            onChange={(event) => onChange({ ...input, wheelInvert: event.target.checked })}
          />
          Reverse scroll direction
        </label>

        <label className="field field-wide">
          <span>Rotation batching (ms)</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={input.rotateFlushMs}
            onChange={(event) =>
              onChange({ ...input, rotateFlushMs: Number(event.target.value) })
            }
          />
        </label>
      </div>

      <p className="panel-note">
        Dial steps are gathered for this long and sent as one adjustment, so a
        fast spin is a single call rather than a queue. Lower it if the dial
        feels laggy. To see raw events from the device itself, open{' '}
        <code>/#input</code> on the device.
      </p>
    </section>
  );
}
