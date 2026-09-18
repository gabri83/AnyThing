import {
  DEFAULT_INPUT_CONFIG,
  actionForGesture,
  definePlugin,
  gestureForKey,
  rotateDelta,
  type ControlBindings,
  type InputConfig
} from '@anything/shared';
import { DEFAULT_CONFIG, normalizeInput, type AnythingConfig } from './config';
import { PluginHost } from './host';

function config(): AnythingConfig {
  return { ...DEFAULT_CONFIG, plugins: {} };
}

describe('rotateDelta', () => {
  it('reads a signed step count', () => {
    expect(rotateDelta({ delta: 3 })).toBe(3);
    expect(rotateDelta({ delta: -2 })).toBe(-2);
  });

  it('rejects anything that is not a usable delta', () => {
    // Zero is rejected too: a rotation of nothing is not a rotation.
    expect(rotateDelta({ delta: 0 })).toBeNull();
    expect(rotateDelta({ delta: 'lots' })).toBeNull();
    expect(rotateDelta({ delta: Number.NaN })).toBeNull();
    expect(rotateDelta({})).toBeNull();
    expect(rotateDelta(null)).toBeNull();
    expect(rotateDelta(7)).toBeNull();
  });
});

describe('gestureForKey', () => {
  it('maps a key through the keymap', () => {
    expect(gestureForKey(DEFAULT_INPUT_CONFIG, 'ArrowRight')).toBe('rotate-cw');
    expect(gestureForKey(DEFAULT_INPUT_CONFIG, 'ArrowLeft')).toBe('rotate-ccw');
    expect(gestureForKey(DEFAULT_INPUT_CONFIG, 'Escape')).toBe('back');
    expect(gestureForKey(DEFAULT_INPUT_CONFIG, '3')).toBe('preset3');
  });

  it('returns null for an unmapped key', () => {
    expect(gestureForKey(DEFAULT_INPUT_CONFIG, 'q')).toBeNull();
  });

  it('falls back to a code: binding when the key itself is not mapped', () => {
    // Some images report a physical control with no useful `key` value.
    const custom: InputConfig = {
      ...DEFAULT_INPUT_CONFIG,
      keymap: { 'code:Numpad4': 'preset4' }
    };
    expect(gestureForKey(custom, 'Unidentified', 'Numpad4')).toBe('preset4');
    expect(gestureForKey(custom, 'Unidentified', 'Numpad9')).toBeNull();
  });

  it('prefers a key binding over a code binding', () => {
    const custom: InputConfig = {
      ...DEFAULT_INPUT_CONFIG,
      keymap: { a: 'press', 'code:KeyA': 'back' }
    };
    expect(gestureForKey(custom, 'a', 'KeyA')).toBe('press');
  });
});

describe('actionForGesture', () => {
  const bindings: ControlBindings = {
    rotate: 'vol',
    press: 'pp',
    back: 'esc',
    presets: ['one', undefined, 'three']
  };

  it('sends both rotation directions to the same action', () => {
    // The handler gets a signed delta, so two handlers would be redundant.
    expect(actionForGesture(bindings, 'rotate-cw')).toBe('vol');
    expect(actionForGesture(bindings, 'rotate-ccw')).toBe('vol');
  });

  it('maps buttons and presets', () => {
    expect(actionForGesture(bindings, 'press')).toBe('pp');
    expect(actionForGesture(bindings, 'back')).toBe('esc');
    expect(actionForGesture(bindings, 'preset1')).toBe('one');
    expect(actionForGesture(bindings, 'preset3')).toBe('three');
  });

  it('returns undefined for a preset with no binding', () => {
    expect(actionForGesture(bindings, 'preset2')).toBeUndefined();
    expect(actionForGesture(bindings, 'preset4')).toBeUndefined();
  });

  it('returns undefined when the page binds nothing', () => {
    expect(actionForGesture(undefined, 'press')).toBeUndefined();
    expect(actionForGesture({}, 'rotate-cw')).toBeUndefined();
  });
});

describe('normalizeInput', () => {
  it('falls back to the defaults for junk', () => {
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT_CONFIG);
    expect(normalizeInput('nope')).toEqual(DEFAULT_INPUT_CONFIG);
  });

  it('keeps valid bindings and drops invalid ones', () => {
    const result = normalizeInput({
      keymap: { a: 'press', b: 'teleport', c: 'rotate-cw', d: 42 }
    });
    // One typo costs that key, not the whole mapping.
    expect(result.keymap).toEqual({ a: 'press', c: 'rotate-cw' });
  });

  it('restores the default keymap when every entry was invalid', () => {
    // A device with no controls at all is worse than a wrong guess.
    const result = normalizeInput({ keymap: { a: 'nonsense' } });
    expect(result.keymap).toEqual(DEFAULT_INPUT_CONFIG.keymap);
  });

  it('honours wheel settings and clamps the flush window', () => {
    expect(normalizeInput({ wheel: false }).wheel).toBe(false);
    expect(normalizeInput({ wheelInvert: true }).wheelInvert).toBe(true);
    expect(normalizeInput({ rotateFlushMs: 150 }).rotateFlushMs).toBe(150);
    expect(normalizeInput({ rotateFlushMs: -5 }).rotateFlushMs).toBe(80);
    expect(normalizeInput({ rotateFlushMs: 99_999 }).rotateFlushMs).toBe(80);
    expect(normalizeInput({ rotateFlushMs: 'soon' }).rotateFlushMs).toBe(80);
  });
});

describe('PluginHost control bindings', () => {
  it('publishes bindings on the plugin page', async () => {
    const host = new PluginHost(config());
    await host.register(
      definePlugin({
        manifest: { id: 'alpha', name: 'Alpha', version: '1.0.0' },
        setup(api) {
          api.setControls({ rotate: 'vol', press: 'pp' });
        }
      })
    );

    expect(host.pages()[0].controls).toEqual({ rotate: 'vol', press: 'pp' });
    expect(host.controlsFor('alpha')).toEqual({ rotate: 'vol', press: 'pp' });
  });

  it('defaults to no bindings for a plugin that sets none', async () => {
    const host = new PluginHost(config());
    await host.register(
      definePlugin({
        manifest: { id: 'alpha', name: 'Alpha', version: '1.0.0' },
        setup: () => {}
      })
    );
    expect(host.controlsFor('alpha')).toEqual({});
  });

  it('emits when bindings change so a device can rebind live', async () => {
    const host = new PluginHost(config());
    const emitted: Array<[string, ControlBindings]> = [];
    host.on('controls', (id: string, bindings: ControlBindings) =>
      emitted.push([id, bindings])
    );

    let rebind: (bindings: ControlBindings) => void = () => {};
    await host.register(
      definePlugin({
        manifest: { id: 'alpha', name: 'Alpha', version: '1.0.0' },
        setup(api) {
          rebind = api.setControls;
          api.setControls({ rotate: 'first' });
        }
      })
    );

    rebind({ rotate: 'second' });

    expect(emitted).toEqual([
      ['alpha', { rotate: 'first' }],
      ['alpha', { rotate: 'second' }]
    ]);
  });

  it('routes a rotate invocation with its delta to the bound action', async () => {
    const host = new PluginHost(config());
    const deltas: number[] = [];

    await host.register(
      definePlugin({
        manifest: { id: 'alpha', name: 'Alpha', version: '1.0.0' },
        setup(api) {
          api.setControls({ rotate: 'vol' });
          api.onAction('vol', (payload) => {
            const delta = rotateDelta(payload);
            if (delta !== null) deltas.push(delta);
          });
        }
      })
    );

    const bindings = host.controlsFor('alpha');
    await host.invoke('alpha', actionForGesture(bindings, 'rotate-cw') as string, {
      delta: 4
    });
    await host.invoke('alpha', actionForGesture(bindings, 'rotate-ccw') as string, {
      delta: -1
    });

    expect(deltas).toEqual([4, -1]);
  });
});
