# Settings

There is no separate app to install. The host serves its own settings page:

```
http://localhost:3000/#settings
```

The host prints that link at startup. Open it in any browser on the Mac — there
is also a gear icon in the top bar of the controller itself.

**It is a local web page, not a native `.app`.** No dock icon, no menu bar item.
If that matters, see [Wrapping it](#wrapping-it) at the end.

## Macros

The tab you probably want. Each macro is one button on the device, in the order
listed.

Per macro:

| Field | Notes |
| --- | --- |
| Label | Shown on the button. The id is derived from it until you have saved one |
| Icon | One character or emoji |
| Colour | Eight named accents |
| Type | Shell, AppleScript, Shortcut, Keystroke, or Open |
| Command | Multi-line for shell and AppleScript; a single field otherwise |
| Modifiers | Keystroke only — command, control, option, shift |
| Ask twice | Arms on the first press, fires on the second |
| Width | 1–6 columns |

The arrows reorder, which is the order on the device. **Test** runs a macro
immediately so you are not guessing whether the command works — it runs the
version *saved on the host*, so save before testing.

Edits are held until you press **Save**. These fields describe commands that
will run on your Mac; a half-typed one should not reach the device. An orange
dot in the bar means unsaved changes, and a macro missing a label or a command
is outlined in red and blocks the save.

Saving applies immediately — no restart. The plugins are torn down and reloaded
under the new config, and connected devices get the new layout straight away.

## Plugins

Every plugin the host can see, whether loaded or not, with a switch each.
Unsupported ones stay listed and greyed with the reason (`needs darwin, host is
linux`) rather than vanishing.

To add a plugin, drop a folder containing `index.js` into the directory shown at
the top of the tab — normally `~/.anything/plugins` — then press **Rescan
folder**. No restart. A folder that fails to load is listed with its error, so a
typo does not look like the folder being ignored.

See [PLUGINS.md](PLUGINS.md) for writing one.

## Dial & buttons

One row per gesture. Press **Learn**, then turn the dial or press the button,
and whatever it sends is bound. That is easier and less error-prone than working
out that your device reports a button as `code:Numpad7` and typing it in.

Learning replaces any previous binding for that gesture, and takes the key away
from whatever else had it, so one key always means one thing. Click a key chip
to unbind it.

Also here: whether scrolling counts as dial rotation, whether to reverse its
direction, and the rotation batching window. [CONTROLS.md](CONTROLS.md) explains
what those do.

To see raw events as the device sends them, open `/#input` **on the device**.

## Host

Port and listen address (both need a restart — the page says so), whether a
token is required, and a button to issue a new one. Also the device URL and the
paths to your config and plugin folders.

## Who can change settings

- **Reading** settings needs the token, unless the request comes from the Mac
  itself. Anything running as you can already read `~/.anything/config.json`, so
  demanding a credential would only stop the settings page from opening.
- **Writing** settings is refused from other machines unless you tick "Allow
  editing these settings from other machines". Knowing the token lets you *use*
  the controller; rewriting what its buttons do is a bigger thing, because a
  macro is a shell command your Mac will run.
- A write carrying a foreign `Origin` is refused, so a random page in your
  browser cannot post new macros to the host behind your back.
- The token is never returned by the settings API — it reads `***`. The one
  exception is the rotate endpoint, which exists to hand you a new one.

## Wrapping it

If you want a real Mac app — dock icon, menu bar, launch at login — the
shortest path is a thin wrapper around this same page, since a native window
would be showing exactly this. That has not been built, and could not be tested
from the environment this was written in, so it is deliberately not in the repo
rather than shipped untried.

Two options, roughly:

- **A menu-bar wrapper** (Tauri or Electron) pointing a window at
  `http://localhost:3000/#settings`, starting and stopping the host with the app.
  Most of the work is process supervision and launch-at-login, not UI.
- **A `launchd` agent** to keep the host running in the background, plus a
  browser bookmark. Not an app, but it covers "always running" in a few lines
  of plist, which is usually the real want.
