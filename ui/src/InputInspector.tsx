import { INPUT_GESTURES, type ControlBindings, type InputConfig } from '@anything/shared';
import type { RawInputEvent } from './input';

export interface InputInspectorProps {
  input: InputConfig | null;
  bindings: ControlBindings | undefined;
  events: RawInputEvent[];
  onClose: () => void;
}

/**
 * Shows what the device is actually sending.
 *
 * The flashed image decides what the dial and buttons emit, and there is no way
 * to know from here what yours does. So rather than shipping a guess and hoping,
 * this prints every key and wheel event with the gesture it resolved to — turn
 * the dial, press the buttons, and write the answers into the keymap.
 */
export function InputInspector({ input, bindings, events, onClose }: InputInspectorProps) {
  const bound = INPUT_GESTURES.filter((gesture) => {
    switch (gesture) {
      case 'rotate-cw':
      case 'rotate-ccw':
        return Boolean(bindings?.rotate);
      case 'press':
        return Boolean(bindings?.press);
      case 'back':
        return Boolean(bindings?.back);
      default: {
        const index = Number(gesture.replace('preset', '')) - 1;
        return Boolean(bindings?.presets?.[index]);
      }
    }
  });

  return (
    <div className="inspector">
      <div className="inspector-head">
        <h1>Input inspector</h1>
        <button type="button" className="inspector-close" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="inspector-intro">
        Turn the dial and press each button. Every event shows up below with the
        gesture it mapped to. Anything that says <em>unmapped</em> needs adding to{' '}
        <code>input.keymap</code> in <code>~/.anything/config.json</code>.
      </p>

      <div className="inspector-cols">
        <div>
          <h2>Events</h2>
          {events.length === 0 ? (
            <p className="inspector-empty">
              Nothing yet. Turn the dial or press a button.
            </p>
          ) : (
            <ul className="inspector-events">
              {events.map((event) => (
                <li key={`${event.at}-${event.detail}-${event.source}`}>
                  <span className="inspector-source">{event.source}</span>
                  <span className="inspector-detail">{event.detail}</span>
                  {event.code && event.code !== event.detail && (
                    <span className="inspector-code">code:{event.code}</span>
                  )}
                  {event.gesture ? (
                    <span className="inspector-gesture">
                      {event.gesture}
                      {event.action ? ` → ${event.action}` : ' (page has no binding)'}
                    </span>
                  ) : (
                    <span className="inspector-unmapped">unmapped</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2>Current keymap</h2>
          {input ? (
            <ul className="inspector-keymap">
              {Object.entries(input.keymap).map(([key, gesture]) => (
                <li key={key}>
                  <code>{key === ' ' ? 'Space' : key}</code>
                  <span>{gesture}</span>
                </li>
              ))}
              <li>
                <code>wheel</code>
                <span>
                  {input.wheel
                    ? `rotation${input.wheelInvert ? ', inverted' : ''}`
                    : 'off'}
                </span>
              </li>
            </ul>
          ) : (
            <p className="inspector-empty">Waiting for the host.</p>
          )}

          <h2>Bound by this page</h2>
          {bound.length === 0 ? (
            <p className="inspector-empty">
              This page binds no physical controls.
            </p>
          ) : (
            <p className="inspector-bound">{bound.join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
