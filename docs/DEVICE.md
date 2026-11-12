# The Car Thing

## What it actually is

The Spotify Car Thing (codename **superbird**) is an Amlogic S905D2 board
running Linux, with an 800×480 landscape touchscreen, four preset buttons, a
dial that also presses, a back button, a microphone array and Bluetooth, over
USB-C. It has **no Wi-Fi** — the radio is a Bluetooth-only BCM20703A2.

It is **not** a USB display. Once flashed with a community image it runs a
Chromium kiosk, and AnyThing is a web page as far as it is concerned. That is
why you can use all of this from a laptop and sort the hardware out whenever.

## Bridgething: plug in and it works

This is the path the project is developed and tested against (Bridgething
0.2.5, kernel 7.0.2, Chromium 147).

With the host running, plug the Car Thing into the Mac. A few seconds after it
boots, AnyThing is on its screen. There is nothing to configure and nothing is
installed on the device.

How, in case it does not:

- The image exposes **USB networking**: the device is `10.42.1.82` and hands
  the Mac an address on the same link.
- It runs `sshd` (root, no password) and its kiosk has a DevTools port on the
  device's own loopback.
- The host's connector opens **one ssh process** with two forwards: one lets
  the kiosk load the UI from the Mac (`127.0.0.1:7780` on the device), the
  other lets the host tell the kiosk which page to show.
- For the first minute after connecting the connector keeps putting AnyThing
  back, because a booting device loads its own page a moment after the browser
  starts. After that it leaves the screen alone — press `m` five times for
  Bridgething's own launcher.
- Stopping the host gives the screen back to Bridgething. So does unplugging.

Because the device comes in through that tunnel, **the host listens on
loopback only** by default and the device needs no token. A tethered device can
use the controller but cannot change settings or call plugin webhooks.

```json
"device": { "carThing": { "enabled": true, "address": "10.42.1.82" } }
```

Set `enabled` to `false` to stop the host looking for one.

### Starting on AnyThing at power-on

Out of the box the device boots to Bridgething's own page and the host takes
the screen a couple of seconds later. To make it start on AnyThing instead:

```bash
anything device install
```

That writes two files to the device's writable partition: a small splash page,
and the kiosk override the firmware already looks for
(`/opt/bridgething/kiosk-env`). From the next power-on the device shows the
AnyThing splash, which hands over as soon as the host is reachable. Plugged
into a charger or another computer it stays on the splash and, after a few
seconds, offers "Use the device without a Mac", which opens Bridgething's own
interface. Nothing in the firmware is modified;
`anything device uninstall` removes both files.

### Checking what is on the screen

`GET /status` lists connected clients with their user agent. The host log says
`[carthing] AnyThing is on the Car Thing screen` when the kiosk has loaded it.

### Controls, as measured

| Control | What the page receives |
| --- | --- |
| Dial, one click | `wheel` event, `deltaX` ±120 (`deltaY` 0) |
| Dial press | `Enter` |
| Back button | `Escape` |
| Preset buttons 1–4 | `1` `2` `3` `4` |
| Settings button | `m` (five quick presses return to Bridgething's launcher) |
| Touch | ordinary pointer events |

The default keymap matches this, so nothing needs learning. If the dial runs
backwards, set `input.wheelInvert`.

## Nocturne and other images

> Not verified by this project. The steps are drawn from the Nocturne
> community, and the details differ between image versions.

Nocturne also runs a Chromium kiosk and exposes USB networking — the device is
`nocturne.local` or `172.16.42.2`, the Mac `172.16.42.1` — but the automatic
connector above is written for Bridgething. On Nocturne, repoint the kiosk by
hand:

1. Set `server.host` to `0.0.0.0` in the config so the device can reach the
   host, then `anything url` for a URL with the token
2. `npm run find-device` to confirm the device answers and which address it
   must call back on
3. `ssh root@nocturne.local` (password `nocturne`), `mount -o remount,rw /`
4. Find where the kiosk URL is set — `grep -rn chromium /etc/supervisord.conf
   /scripts/` — and point it at `http://172.16.42.1:3000/?token=…`
5. `sync && mount -o remount,ro /`, then `supervisorctl restart chromium`

Copy the original line somewhere first so you can put it back.

### The browser may be old, and it matters

The stock image and the Nocturne-era images run QtWebEngine 5.12 — **Chromium
69**. Bridgething ships Chromium 147, but the UI is still built for the old one
so a single build works everywhere:

- optional chaining (`?.`) and nullish coalescing (`??`) are Chrome 80. One of
  either in the bundle is a syntax error and a blank screen.
- `gap` inside a **flex** container is Chrome 84 and is silently ignored. Grid
  gap is fine.
- `color-mix()` is Chrome 111, `aspect-ratio` Chrome 88, the `inset` shorthand
  Chrome 87, `:is()` and `:where()` Chrome 88.

The UI builds with `target: 'chrome69'`, the device stylesheet avoids all of
the above, and `npm run check:device` enforces both. The settings page is
exempt: it is only opened on the Mac.

## Which firmware is on yours?

Power it on and look at the screen.

- **Spotify branding** or a setup prompt — stock, never flashed.
- **A Bridgething screen** — plug it in; see above.
- **A Nocturne splash or UI** — see the Nocturne section.
- Something else — some other custom image; it will still be a kiosk pointing
  at *some* URL, and the job is the same shape.

## Screen

The UI targets 800×480 landscape: three rows of six tiles under one bar, touch
targets sized for a thumb. Under 720px wide it becomes a two-column scrolling
list, which is what makes it usable on a phone.
