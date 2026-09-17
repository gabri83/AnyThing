# Writing an AnyThing plugin

A plugin publishes tiles and handles presses. That is the whole model: the three
bundled plugins use this same API and get no privileges yours does not.

## The shape

```js
module.exports = {
  manifest: {
    id: 'my-plugin',        // unique, kebab-case; used for config and routing
    name: 'My Plugin',      // shown in the page switcher
    version: '1.0.0',
    description: 'What it does',
    icon: '★',              // one character or emoji
    platforms: ['darwin'],  // optional; omit to run anywhere
    defaultConfig: { pollMs: 2000 }
  },

  setup(api) {
    // Register actions, publish tiles, start polling.
  },

  teardown() {
    // Optional. Timers and files you registered through the api are already
    // cleaned up for you; this is for anything else you opened.
  }
};
```

Install it at `~/.anything/plugins/<anything>/index.js` and restart the host.
Plain CommonJS, no build step. A plugin whose `setup` throws is rolled back and
skipped with a logged reason — it cannot stop the host or other plugins from
starting.

If you write TypeScript, `import { definePlugin } from '@anything/shared'` gives
you the types; the bundled plugins under `server/src/plugins/` are the reference.

## The api object

| Member | Purpose |
| --- | --- |
| `api.config` | Your config from `~/.anything/config.json`, with your `defaultConfig` merged underneath |
| `api.platform`, `api.arch` | `process.platform` / `process.arch`, for plugins supporting several |
| `api.setTiles(tiles)` | Publish your page. Replaces your previous tiles |
| `api.onAction(id, handler)` | Handle a press. `handler(payload)` may be async |
| `api.every(ms, fn)` | Poll. Minimum 50ms. Runs immediately, then on the interval |
| `api.serveFile(name, path)` | Serve a local file to the device; returns its URL |
| `api.log`, `api.warn` | Namespaced logging — prefer these over `console` |
| `api.notify(level, msg)` | Show a transient message on connected devices |

Three behaviours worth knowing:

- **`setTiles` is cheap to call often.** The host fingerprints your tiles and
  broadcasts only when something actually changed, so calling it on every poll
  costs nothing when nothing moved.
- **`every` skips overlapping runs.** If your poll takes longer than its
  interval, the next tick is dropped rather than queued, so a slow AppleScript
  call cannot pile up behind itself.
- **`every` is cleaned up at teardown.** Use it instead of `setInterval`.

## Tiles

The grid is **6 columns × 3 rows**. A tile occupies one cell unless it sets `w`
(1–6) and `h` (1–3). On a phone the grid drops to two columns and scrolls.

Every tile needs an `id` unique within your plugin, and may set
`color`: `neutral`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`.

### button

```js
{ kind: 'button', id: 'go', label: 'Run Build', icon: '⚙', color: 'green',
  action: 'build', payload: { target: 'release' }, confirm: false }
```

`confirm: true` arms on the first press and fires on the second, lapsing after
three seconds. Worth setting on anything you would regret triggering with a
sleeve.

### toggle

```js
{ kind: 'toggle', id: 'mute', label: 'Mute', icon: '✕', on: isMuted, action: 'toggle-mute' }
```

You own `on`: the host does not flip it for you. Handle the action, change your
state, and call `setTiles` again. The screen then shows what is actually true on
the Mac rather than what was pressed.

### gauge

```js
{ kind: 'gauge', id: 'cpu', w: 2, label: 'CPU', value: 42.5, max: 100,
  unit: '%', sublabel: 'load 1.20 across 8 cores', warnAt: 85,
  unavailableHint: 'No sensor tool' }
```

`value: null` renders the tile as unavailable and shows `unavailableHint` — use
it when a reading is genuinely missing. Do not send `0` for "unknown": a fan at
0 RPM and a fan you cannot read are different facts, and the screen should not
claim the first when it means the second.

### text

```js
{ kind: 'text', id: 'uptime', w: 3, label: 'Uptime', value: '3h 25m' }
```

### now-playing

```js
{ kind: 'now-playing', id: 'player', w: 6, h: 2,
  status: 'playing',              // 'playing' | 'paused' | 'stopped'
  title: 'Shipbuilding', artist: 'Robert Wyatt', album: 'Nothing Can Stop Us',
  artwork: '/files/my-plugin/art.jpg',   // or null
  position: 71, duration: 199,           // seconds; duration 0 hides the bar
  actions: { playPause: 'pp', next: 'n', previous: 'p', seek: 's' } }
```

Omit an action to hide its control. The `seek` action is invoked with
`{ position: <seconds> }`. The UI advances the progress bar locally between your
updates and snaps to whatever you report, so a poll every second or two is
plenty.

## Serving files

```js
const url = api.serveFile('art.jpg', '/tmp/my-art.jpg');
// -> '/files/my-plugin/art.jpg', ready to put in a tile
api.serveFile('art.jpg', null);   // stop serving it
```

Only the exact paths you register are reachable, and the name must be a bare
filename. Give the file a name that changes when its contents change — the
bundled music plugin includes the track id — or a device will show you a cached
version of the last one.

## Config

Users configure your plugin under its id:

```json
{ "plugins": { "my-plugin": { "enabled": true, "pollMs": 5000 } } }
```

`api.config` is `{ ...defaultConfig, ...userConfig }`. Validate it rather than
trusting it — a `pollMs` of `"fast"` should fall back to your default, not crash
your setup. Collect problems and report them instead of throwing on the first
one, so one typo costs the user one button rather than the whole plugin. The
`macros` plugin does this: bad entries are skipped, listed in the log, and shown
on the device in a red tile.

## Actions

```js
api.onAction('build', async (payload) => {
  await doTheThing(payload);
  render();               // publish the new state
});
```

A handler that throws is caught: the message goes to the log and to the device
as an error toast, and the host stays up. So let a real failure throw — it is
more useful on screen than swallowed.

Pair each action with a fresh `setTiles` so the device reflects the result
immediately rather than at the next poll.
