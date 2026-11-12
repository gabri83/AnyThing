# The dial and the buttons

The Car Thing has a rotary dial that also presses, a back button, and four
preset buttons. On the music page the dial is volume. On another plugin's page
it can mean something else entirely.

## How it works

Nothing in the plugin code names a key. There are three layers:

1. The **image** on your device decides what the dial and buttons emit — arrow
   keys, digits, mouse-wheel scrolling, something else. Different images differ.
2. A **keymap** turns those raw browser events into *gestures*:
   `rotate-cw`, `rotate-ccw`, `press`, `back`, `preset1`–`preset4`.
3. A **plugin** binds gestures to its own actions, and only while its page is
   the one on screen.

That middle layer is the point. Your device can send whatever it likes and the
plugins stay correct — an unknown device is a config change, not a code change.

## Finding out what your device sends

Open **`/#input`** on the device — the URL the host printed, with `#input` on
the end. Turn the dial, press every button, and watch what arrives:

```
KEY     ArrowRight   code:ArrowRight    rotate-cw → dial-volume
WHEEL   deltaX +120                     rotate-cw → dial-volume
KEY     q            code:KeyQ          unmapped
```

`unmapped` means the keymap has no entry for it. Note the key (or the `code:`
value) and add it below. The inspector reports events **without firing them**,
so you can find out what a button does without it muting your mic.

## Fixing the keymap

Easiest is the **Dial & buttons** tab of the settings page
(`http://localhost:3000/#settings`): press Learn next to a gesture, then turn
the dial or press the button, and whatever it sent is bound. See
[SETTINGS.md](SETTINGS.md).

By hand, in `~/.anything/config.json`:

```json
{
  "input": {
    "keymap": {
      "ArrowRight": "rotate-cw",
      "ArrowLeft": "rotate-ccw",
      "Enter": "press",
      "Escape": "back",
      "1": "preset1",
      "2": "preset2",
      "3": "preset3",
      "4": "preset4",
      "code:Numpad7": "preset1"
    },
    "wheel": true,
    "wheelInvert": false,
    "rotateFlushMs": 80
  }
}
```

- Keys match `KeyboardEvent.key`. Prefix with `code:` to match
  `KeyboardEvent.code` instead — useful when an image reports a control with no
  meaningful `key`.
- `wheel` treats scrolling as dial rotation. Some images report the dial that
  way rather than as keys.
- `wheelInvert` flips which scroll direction counts as clockwise. A key binding
  in the wrong direction you can fix by swapping two entries; a wheel you
  cannot, hence the flag.
- An entry naming a gesture that does not exist is dropped, and the rest of the
  map still loads. If *every* entry is invalid the defaults come back, because a
  device with no working controls is worse than a wrong guess.

Editing by hand needs a host restart; saving from the settings page applies
immediately and pushes the new keymap to devices that are already connected.
Either way the mapping lives on the host, so there is nothing to configure per
device.

## Why rotation is batched

A dial emits a burst of steps. On the music page each step is an AppleScript
round trip, so forwarding them one at a time means the volume trails a second
behind your hand.

Instead, rotation accumulates for `rotateFlushMs` (80ms by default) and
dispatches once with a signed step count. Ten fast clicks become **one** call
with `delta: 10`; three deliberate clicks stay three calls of `delta: 1`. Lower
it if the dial feels laggy, raise it if a fast spin still causes a backlog.

## What the bundled plugins bind

`apple-music`:

| Control | Action |
| --- | --- |
| Dial rotate | Volume, `volumeStep` percent per click |
| Dial press | Play/pause |
| Preset 1–4 | Previous, play/pause, next, shuffle |

`sysmon` and `macros` bind nothing yet. A page that binds no rotation shows no
dial indicator in the top bar, and turning the dial there does nothing rather
than falling through to another page.

## Binding controls in your own plugin

```js
api.onAction('adjust', (payload) => {
  const delta = payload.delta;         // signed steps, e.g. +3 or -1
  setBrightness(brightness + delta * 5);
  render();
});

api.setControls({
  rotate: 'adjust',
  press: 'toggle',
  back: 'reset',
  presets: ['preset-a', 'preset-b', undefined, 'preset-d']
});
```

Both rotation directions go to the same action — the sign of `delta` carries the
direction, so there is no second handler to keep in step with the first.

**Scale by `delta`.** Treating each call as one click throws away the fast-spin
information and makes the dial feel dead. `@anything/shared` exports
`rotateDelta(payload)` to read it safely.

Bindings can change at runtime: call `setControls` again and connected devices
rebind immediately.
