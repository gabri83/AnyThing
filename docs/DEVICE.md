# The Car Thing

## What it actually is

The Spotify Car Thing (codename **superbird**) is an Amlogic S905D3 board
running Linux, with an 800×480 landscape touchscreen, four preset buttons, a
dial and a back button, over USB-C.

It is **not** a USB display. You flash it once, and afterwards it runs a
Chromium kiosk. AnyThing is a web page as far as it is concerned, which is why
you can use all of this from a laptop and sort the hardware out whenever.

> The software in this repo is tested. The device-side steps below are drawn
> from the Nocturne project and its community, **not verified by this project**,
> and the details differ between image versions. Read upstream before writing to
> the device.

## The browser is old, and it matters

The stock image runs QtWebEngine 5.12.7 — **Chromium 69.0.3497**. The custom
images still build for that target. This is the single biggest constraint on
the UI, and it fails loudly rather than gracefully:

- optional chaining (`?.`) and nullish coalescing (`??`) are **Chrome 80**. One
  of either anywhere in the bundle is a syntax error and a blank screen, with
  nothing in the host log to explain it.
- `gap` inside a **flex** container is Chrome 84. It is silently ignored, and
  everything ends up touching. Grid gap is fine — Chrome 66.
- `color-mix()` is Chrome 111, `aspect-ratio` Chrome 88, the `inset` shorthand
  Chrome 87, `:is()` and `:where()` Chrome 88.

So the UI builds with `target: 'chrome69'`, the device stylesheet avoids all of
the above, and `npm run check:device` enforces both — it parses every emitted
JS file as ES2019 and scans `ui/src/styles.css` for features that are too new.
It runs as part of `npm run build` and in CI.

The settings page is exempt: that one is only ever opened on the Mac, and its
styles live in `ui/src/settings/settings.css`.

**To find out what your device actually runs**, connect it and look at the host's
terminal. Every connection logs the browser's user agent:

```
[ws] device connected (1 total)
[ws]   Mozilla/5.0 (X11; Linux ...) ... Chrome/69.0.3497.128 Safari/537.36
```

It is also in `GET /status` under `connected`. If yours turns out to be newer,
the target in `ui/vite.config.ts` can be raised.

## If you have Nocturne

Good news first: **it is already flashed**, so there is nothing to reflash. It
already runs a Chromium kiosk — it just points at Nocturne's own app, and the
job is repointing it.

Better news: Nocturne exposes the device over **USB networking** (CDC-NCM), so
the device can reach a server on your Mac with no Wi-Fi involved. The device is
`nocturne.local`, or `172.16.42.2`; your Mac is the other end of that link,
usually `172.16.42.1`.

Run this on the Mac with the device plugged in:

```bash
npm run find-device
```

It looks for the device on USB, finds which interface your Mac is using, checks
that the device answers, works out the address the device must call *back* on,
and prints the exact steps for the rest. It only looks — it changes nothing.

The shape of it:

1. `node server/dist/cli.js url` for a token
2. `ssh root@nocturne.local` — the password is `nocturne`
3. `mount -o remount,rw /`
4. Find where the kiosk URL is set and point it at
   `http://172.16.42.1:3000/?token=…`
   - older images: the `command=` line under `[program:chromium]` in
     `/etc/supervisord.conf`, usually ending `--app=http://localhost:80`
   - newer images: `/scripts/chromium_settings.sh`
   - `grep -rn chromium /etc/supervisord.conf /scripts/` finds whichever
5. `sync && mount -o remount,ro /` then `supervisorctl restart chromium`

Copy the original line somewhere first so you can put it back.

The token only needs to be in the URL once — the page moves it into local
storage. If you would rather not have a credential sitting in a config file on
the device, set `auth.enabled` to `false` and `server.host` to `172.16.42.1`, so
the host is reachable only over the USB link. That is a real trade: read the
token section of the README first.

## Which firmware is on yours?

Power it on and look at the screen.

- **Spotify branding** or a setup prompt — stock, never flashed.
- **A Nocturne splash or UI** — Nocturne. See above.
- Something else — some other custom image; it will still be a kiosk pointing
  at *some* URL, and the job is the same shape.

## Why there is no firmware in this repo

An earlier version of this project contained a firmware tree targeting an
**nRF52840** — a Cortex-M4 microcontroller with 1MB of flash — plus a USB
protocol for pushing RGB565 frame buffers to it.

The Car Thing contains no nRF52840 and nothing in it works that way. That code
could never have run on the hardware it named, so it was removed rather than
carried forward.

## Screen and controls

The UI targets 800×480 landscape, three rows of six tiles, no scrolling, with
touch targets sized for a thumb. Under 720px wide it becomes a two-column
scrolling list, which is what makes it usable on a phone.

The dial, back button and presets are wired up — what they emit depends on the
image, so the mapping is configurable and there is an inspector at `/#input`.
See [CONTROLS.md](CONTROLS.md).
