# AnyThing

Turn a Spotify Car Thing — or any spare screen — into a plugin-driven controller
for your Mac.

A small server runs on your Mac. Plugins publish **tiles**; the device renders
them in a grid and sends presses back. Plug a Car Thing into the Mac and
AnyThing appears on its screen. Six plugins ship with it:

| Plugin | What it does |
| --- | --- |
| `apple-music` | Play/pause, skip, seek, album art, volume, shuffle. The dial is volume |
| `macros` | A Stream Deck: shell commands, AppleScript, Shortcuts, keystrokes |
| `sysmon` | CPU and memory always; temperature and fans where the Mac allows |
| `todo` | A to-do list ticked off with the dial. Add items from the Mac: `anything todo "Buy milk"` |
| `calendar` | What is coming up, from any iCalendar (.ics) feed — iCloud, Google, Outlook |
| `claude-code` | Every Claude Code session at a glance, and permission requests answered from the dial ([docs](docs/CLAUDE-CODE.md)) |

Everything the bundled plugins do goes through the same public plugin API, so a
plugin you write has exactly the capabilities they have — including the dial and
the physical buttons.

## Install

On a Mac with [Node.js](https://nodejs.org) 18 or newer and git:

```bash
curl -fsSL https://raw.githubusercontent.com/gabri83/AnyThing/main/install.sh | bash
```

That fetches AnyThing into `~/.anything/app`, builds it, puts an `anything`
command on your PATH and starts the host in the background, now and at every
login. Nothing needs sudo. Read [`install.sh`](install.sh) first if you like to
know what a piped script does.

```bash
anything service      # is it running?
anything update       # fetch the latest version, rebuild, restart
anything help         # everything else
```

To remove it: `bash ~/.anything/app/install.sh --uninstall`. Your settings and
plugins in `~/.anything` are kept.

### From a clone

```bash
git clone https://github.com/gabri83/AnyThing.git
cd AnyThing
npm install
npm run build
npm start                # in the foreground, or:
./install.sh --here      # link the anything command and run this checkout in the background
```

```
  AnyThing host v1.0.0 ready
  Car Thing:            plug it in and AnyThing appears on its screen
  Any other browser:    http://localhost:3000/?token=8f2c...
```

With a Car Thing running the Bridgething image, that is all: plug it in. To try
it without the hardware, open the printed URL in a browser on the Mac. The
token moves into the browser's local storage on first load, so later visits
work without the query string. To use a phone or tablet as a screen, set
`server.host` to `0.0.0.0` and open the same URL with the Mac's address.

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

The Car Thing is an Amlogic S905D2 board running Linux with an 800×480
touchscreen, a dial, five buttons and Bluetooth — and no Wi-Fi. It is not a USB
display: flashed with a community image it runs a Chromium kiosk, and AnyThing
is just a web page to it.

On the **Bridgething** image the host does everything: it notices the device on
USB, tunnels to it over ssh, and points its kiosk at the UI. Nothing is
installed on the device, the host never listens on the network, and unplugging
puts the device back as it was. [docs/DEVICE.md](docs/DEVICE.md) has the detail,
the measured control mapping, and the manual path for Nocturne.

**Older images run a Chromium 69 era browser.** Optional chaining alone would
turn that screen blank, so the UI builds for `chrome69` and
`npm run check:device` fails the build if anything newer creeps in.

### The dial and buttons

The dial controls whichever page is on screen — volume on the music page, the
selected session on the Claude page. What the dial and buttons emit depends on
the image, so the mapping is configuration rather than a guess in the code. The
defaults match Bridgething as measured; for anything else open `/#input` on the
device to see what yours sends, then adjust `input.keymap`.
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
  "server": { "host": "127.0.0.1", "port": 3000 },
  "auth": { "enabled": true, "token": "generated-on-first-run" },
  "input": { "wheel": true, "wheelInvert": false, "rotateFlushMs": 80 },
  "device": { "carThing": { "enabled": true, "address": "10.42.1.82" } },
  "plugins": {
    "apple-music": { "pollMs": 1500, "volumeStep": 5 },
    "calendar": { "feeds": ["https://example.com/my-calendar.ics"], "days": 7 },
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

The host listens on loopback by default: a tethered Car Thing comes in through
the connector's tunnel and needs no token. If you set `server.host` to
`0.0.0.0` for a phone or tablet, remember that the `macros` plugin runs shell
commands — anyone who can reach the port and knows the token can trigger them.
So:

- auth is **on by default** with a random token
- a bad token is refused before any tile is sent
- *changing* settings is refused from other machines unless you allow it: the
  token lets you use the controller, not rewrite what its buttons run
- `anything rotate-token` issues a new one
- plugin webhooks (`/hooks/...`) only ever answer the Mac itself

Turning auth off (`auth.enabled: false`) leaves shell execution open to your
whole network. The host says so loudly at startup if you do.

## CLI

```bash
anything url        # the URL to open on the device
anything status     # config path, port, auth, plugin count
anything plugins    # what is loaded, and why something is not
anything disable macros
anything rotate-token
```

```bash
anything todo "Buy milk"     # add to the to-do page
anything device              # is a Car Thing attached?
anything device install      # start on AnyThing at power-on
anything device uninstall    # put the firmware's start page back
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

### Installing someone else's

```bash
anything plugin add someone/anything-plugin-weather   # a GitHub repository
anything plugin add someone/anything-plugin-weather#v1.2
anything plugin add ./examples/hello-world            # or a folder
anything plugin list
anything plugin update weather
anything plugin remove weather
```

A running host loads the plugin straight away; its page appears on the device
without a restart. **A plugin is a program with the same access to your Mac as
you have** — there is no sandbox — so the command asks before installing. Read
what you install, or trust who wrote it.

To publish one, put a folder with `index.js` at its top level in a public
repository. Naming it `anything-plugin-<name>` is a convention, not a rule; the
prefix is dropped from the installed folder name.

The full API — all six tile kinds, the grid, actions, polling, full-screen
prompts, webhooks, serving files — is in [docs/PLUGINS.md](docs/PLUGINS.md), and
the dial and buttons are in [docs/CONTROLS.md](docs/CONTROLS.md).

## Layout

```
shared/   protocol, tile model, plugin contract (the API plugin authors use)
server/   plugin host, transport, Car Thing connector, settings API, CLI, bundled plugins
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
