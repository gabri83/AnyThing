# AnyThing

Turn a Spotify Car Thing — or any spare screen — into a plugin-driven controller
for your Mac.

A small server runs on your Mac. Plugins publish **tiles**; the device renders
them in a grid and sends presses back. Three plugins ship with it:

| Plugin | What it does |
| --- | --- |
| `apple-music` | Play/pause, skip, seek, album art, volume, shuffle. The dial is volume |
| `macros` | A Stream Deck: shell commands, AppleScript, Shortcuts, keystrokes |
| `sysmon` | CPU and memory always; temperature and fans where the Mac allows |

Everything the bundled plugins do goes through the same public plugin API, so a
plugin you write has exactly the capabilities they have — including the dial and
the physical buttons.

## Quickstart

```bash
git clone https://github.com/gabri83/AnyThing.git
cd AnyThing
npm install
npm run build
npm start
```

The host prints the URL to open, with a token in it:

```
  AnyThing host v1.0.0 ready
  Open on your device:  http://192.168.1.24:3000/?token=8f2c...
```

Open that on anything with a browser — laptop, phone, iPad, or the Car Thing.
The token moves into the browser's local storage on first load, so later visits
work without the query string.

To set up your macros, open the settings page on the Mac:

```
http://localhost:3000/#settings
```

**On first run macOS will ask for permission** to control Music (and, if you use
keystroke macros, for Accessibility). Both prompts are expected; the plugins do
nothing until you grant them.

### Requirements

- macOS for `apple-music` and `macros` (they use AppleScript)
- Node 18+
- Any platform for the host itself — `sysmon` reports CPU and memory anywhere,
  and the host starts cleanly with the macOS-only plugins skipped

## The device

The Car Thing is an Amlogic S905D3 board running Linux with an 800×480
touchscreen. It is not driven over USB: you flash it once with community
tooling, after which it runs a Chromium kiosk you point at your Mac. AnyThing is
just a web page to it, which is why you can use all of this today from a laptop
and sort the hardware out later.

With the device plugged in:

```bash
npm run find-device
```

That finds it over USB networking, works out which address it must call back
on, and prints the steps to repoint its kiosk. It only looks; it changes
nothing. [docs/DEVICE.md](docs/DEVICE.md) has the detail, including the
Nocturne path.

**The device's browser is Chromium 69 era.** That is not a detail — optional
chaining alone would turn the screen blank. The UI builds for `chrome69` and
`npm run check:device` fails the build if anything newer creeps in.

### The dial and buttons

The dial controls whichever page is on screen — volume on the music page. What
the dial and buttons actually emit depends on the image you flashed, so the
mapping is configuration rather than a guess in the code. Open `/#input` on the
device to see exactly what yours sends, then adjust `input.keymap`.
[docs/CONTROLS.md](docs/CONTROLS.md) covers it.

## Settings

The host serves its own settings page at `http://localhost:3000/#settings`, or
the gear icon in the controller's top bar. Four tabs:

- **Macros** — add, edit, reorder and delete Stream Deck buttons, with a Test
  button that runs one immediately. Saving applies without a restart.
- **Plugins** — a switch per plugin, and a rescan button for a folder you just
  dropped one into.
- **Dial & buttons** — press Learn, then turn the dial, and it binds whatever
  your device sent.
- **Host** — port, listen address, token.

It is a local web page rather than a native `.app`.
[docs/SETTINGS.md](docs/SETTINGS.md) covers it, including who is allowed to
change what and what wrapping it in a real Mac app would involve.

## Configuration

Everything in the settings page is stored in `~/.anything/config.json`, which
you can also edit by hand. It is created on first run:

```json
{
  "server": { "host": "0.0.0.0", "port": 3000 },
  "auth": { "enabled": true, "token": "generated-on-first-run" },
  "input": { "wheel": true, "wheelInvert": false, "rotateFlushMs": 80 },
  "plugins": {
    "apple-music": { "pollMs": 1500, "volumeStep": 5 },
    "sysmon": { "pollMs": 2000 },
    "macros": {
      "macros": [
        { "id": "scene-1", "label": "OBS Scene 1", "icon": "🎬",
          "type": "shortcut", "value": "OBS Scene 1" },
        { "id": "lock", "label": "Lock Screen", "type": "keystroke",
          "value": "q", "modifiers": ["command", "control"] },
        { "id": "displays-off", "label": "Displays Off", "type": "shell",
          "value": "pmset displaysleepnow" }
      ]
    }
  }
}
```

Anything under a plugin's key is that plugin's business; `enabled: false`
switches one off. `input` is the dial and button mapping
([docs/CONTROLS.md](docs/CONTROLS.md)). Restart the host after editing.

### A note on the token

The host listens on `0.0.0.0` so the device can reach it, and the `macros`
plugin runs shell commands. Anyone who can reach the port and knows the token
can trigger your macros. So:

- auth is **on by default** with a random token
- a bad token is refused before any tile is sent
- *changing* settings is refused from other machines unless you allow it: the
  token lets you use the controller, not rewrite what its buttons run
- `anything rotate-token` issues a new one
- set `server.host` to `127.0.0.1` if you only ever use it on the Mac itself

Turning auth off (`auth.enabled: false`) leaves shell execution open to your
whole network. The host says so loudly at startup if you do.

## CLI

```bash
node server/dist/cli.js url        # the URL to open on the device
node server/dist/cli.js status     # config path, port, auth, plugin count
node server/dist/cli.js plugins    # what is loaded, and why something is not
node server/dist/cli.js disable macros
node server/dist/cli.js rotate-token
```

`npm link -w @anything/server` puts it on your PATH as `anything`.

## Writing a plugin

A plugin is an object with a manifest and a `setup` function. No build step, no
dependency on this repo:

```js
module.exports = {
  manifest: { id: 'coffee', name: 'Coffee', version: '1.0.0', icon: '☕' },

  setup(api) {
    let cups = 0;

    const render = () => api.setTiles([
      { kind: 'button', id: 'cup', label: `Cups today: ${cups}`,
        icon: '☕', color: 'orange', action: 'add' }
    ]);

    api.onAction('add', () => { cups += 1; render(); });
    render();
  }
};
```

Drop it in `~/.anything/plugins/coffee/index.js` and restart. A working example
with every tile kind is in [`examples/hello-world`](examples/hello-world).

The full API — all five tile kinds, the grid, actions, polling, serving files —
is in [docs/PLUGINS.md](docs/PLUGINS.md), and the dial and buttons are in
[docs/CONTROLS.md](docs/CONTROLS.md).

## Layout

```
shared/   protocol, tile model, plugin contract (the API plugin authors use)
server/   plugin host, transport, settings API, config, CLI, bundled plugins
ui/       the device UI, plus the settings page served to the Mac
examples/ a complete plugin you can copy
scripts/  device compatibility gate, and the Car Thing finder
```

## Development

```bash
npm run build         # shared, then server, then ui, then the device check
npm test              # server suite
npm run typecheck     # all three workspaces
npm run check:device  # bundle parses as ES2019, device CSS is Chromium 69 safe
npm run find-device   # locate a Car Thing attached to this Mac
npm run dev           # host with ts-node
npm run dev:ui        # Vite dev server on :5173, proxying to a host on :3000
```

## License

MIT — see [LICENSE](LICENSE).
