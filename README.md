# AnyThing

Turn a Spotify Car Thing — or any spare screen — into a plugin-driven controller
for your Mac.

A small server runs on your Mac. Plugins publish **tiles**; the device renders
them in a grid and sends presses back. Three plugins ship with it:

| Plugin | What it does |
| --- | --- |
| `apple-music` | Play/pause, skip, seek, album art, volume, shuffle |
| `macros` | A Stream Deck: shell commands, AppleScript, Shortcuts, keystrokes |
| `sysmon` | CPU and memory always; temperature and fans where the Mac allows |

Everything the bundled plugins do goes through the same public plugin API, so a
plugin you write has exactly the capabilities they have.

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
tooling, after which it runs a browser you point at your Mac. AnyThing is just a
web page to it, which is why you can use all of this today from a laptop and
sort the hardware out later.

See [docs/DEVICE.md](docs/DEVICE.md) for how to tell what is currently on your
device and how to point it here.

## Configuration

Config lives at `~/.anything/config.json`, created on first run:

```json
{
  "server": { "host": "0.0.0.0", "port": 3000 },
  "auth": { "enabled": true, "token": "generated-on-first-run" },
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
switches one off. Restart the host after editing.

### A note on the token

The host listens on `0.0.0.0` so the device can reach it, and the `macros`
plugin runs shell commands. Anyone who can reach the port and knows the token
can trigger your macros. So:

- auth is **on by default** with a random token
- a bad token is refused before any tile is sent
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
is in [docs/PLUGINS.md](docs/PLUGINS.md).

## Layout

```
shared/   protocol, tile model, plugin contract (the API plugin authors use)
server/   plugin host, transport, config, CLI, the three bundled plugins
ui/       the device UI: renders tiles, sends presses
examples/ a complete plugin you can copy
```

## Development

```bash
npm run build       # shared, then server, then ui
npm test            # server suite
npm run typecheck   # all three workspaces
npm run dev         # host with ts-node
npm run dev:ui      # Vite dev server on :5173, proxying to a host on :3000
```

## License

MIT — see [LICENSE](LICENSE).
