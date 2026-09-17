# The Car Thing

## What it actually is

The Spotify Car Thing (codename **superbird**) is an Amlogic S905D3 board
running Linux, with an 800×480 8-inch touchscreen, four preset buttons, a dial
and a back button, over USB-C. Spotify discontinued it and pushed a firmware
that unlocked it for other uses.

It is **not** a USB display. You do not stream a frame buffer to it or speak a
HID protocol at it. You flash it once, and afterwards it runs a browser on the
device. AnyThing is a web page as far as it is concerned.

That is why the host is worth running before you touch the hardware: open the
printed URL on a laptop, phone or iPad and everything works. The device is one
more browser, added whenever you get to it.

> The software side of this repo is tested. The flashing steps below are **not**
> verified by this project — they depend on your device's current firmware and
> on upstream tooling that moves. Read the upstream docs before writing to the
> device, and treat anything here as orientation rather than instruction.

## Which firmware is on yours?

Plug it into power and look at the screen.

- **Spotify branding**, a setup prompt, or a "connect to phone" screen — stock
  firmware. It has never been flashed.
- **Anything else** — a DeskThing screen, a clock, a blank kiosk page, an error
  about a server it cannot reach — it has been flashed, and what you see tells
  you roughly with what.

A device flashed with a DeskThing-style image typically exposes `adb` over USB,
so this is a decent second check:

```bash
adb devices
```

If it lists a device, something other than stock is on there. (Install `adb`
with `brew install android-platform-tools`.)

## Pointing a flashed device at this host

A flashed device loads a URL on boot. Getting it to load AnyThing means changing
that URL to the one `anything url` prints. How depends on the image:

- Some images read the address from a config file on the device, reachable over
  `adb shell`.
- DeskThing images generally expect the DeskThing server and configure the
  address through DeskThing itself; whether an arbitrary URL is accepted depends
  on the version you flashed.
- Otherwise, reflash with a generic kiosk image that takes a URL.

Check the current instructions for whatever is on your device:

- **superbird-tool** — flashing, and the recovery path if a write goes wrong
- **DeskThing** — if that is what you flashed, its own docs own this step
- **Nocturne** — the other well-known custom image

If you would rather not reverse-engineer what past-you installed, reflashing
from a known image is usually faster than identifying a mystery one.

## Why there is no firmware in this repo

The earlier version of this project contained a firmware tree targeting an
**nRF52840** — a Cortex-M4 microcontroller with 1MB of flash — plus a USB
protocol for pushing RGB565 frame buffers to it and reading HID reports back.

The Car Thing contains no nRF52840, and nothing in it works that way. That code
could never have run on the hardware it named, so it was removed rather than
carried forward. If custom firmware is ever wanted here it starts from the
Amlogic side and from superbird-tool, not from that tree.

## Screen notes

The UI targets 800×480 in landscape, in three rows of six tiles, with no
scrolling and touch targets sized for a thumb. Under 720px wide it becomes a
two-column scrolling list, which is what makes phone use tolerable.

The dial and the four physical buttons are **not** wired up. The tile model has
no concept of them yet, and a browser on the device only sees them if the image
maps them to key events. Touch works, which is enough for everything the
bundled plugins do.
