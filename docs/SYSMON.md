# Temperature and fan readings

CPU and memory need nothing: they come from the kernel through Node, on every
platform. Temperature and fan speed are the awkward ones, because reading the
SMC needs either a helper binary or root.

`sysmon` handles this by probing at startup and telling you what it found:

```
[sysmon] reading temperature and fans via smctemp
```

or

```
[sysmon] no working sensor tool found; CPU and memory still work.
         Install one: brew install narugit/tap/smctemp or gem install iStats
```

The same message appears on the device in the **Sensors** tile, so you are not
left staring at two blank gauges wondering whether it is broken.

## Recommended: smctemp

Works on both Apple Silicon and Intel, which is why it is probed first:

```bash
brew install narugit/tap/smctemp
```

Check it directly:

```bash
smctemp -c    # CPU temperature
smctemp -f    # fan speed
```

Restart the host and the two gauges fill in.

## The probe order

| Tool | Hardware | Install |
| --- | --- | --- |
| `smctemp` | Apple Silicon and Intel | `brew install narugit/tap/smctemp` |
| `istats` | mainly Intel | `gem install iStats` |
| `osx-cpu-temp` | Intel only, temperature only | `brew install osx-cpu-temp` |
| `sudo powermetrics` | built in, needs a sudoers rule | see below |

Being on `PATH` is not enough to be chosen. Each candidate has to return a real
number before it is accepted, because some of these install happily on hardware
they cannot read — `osx-cpu-temp` on Apple Silicon reports `0.0` forever. A tool
that is present but silent is logged as rejected and the next one is tried.

## Apple Silicon without a helper

`powermetrics` ships with macOS and reads the SMC, but only as root. It is
probed last and only with `sudo -n`, so without a rule it fails instantly rather
than hanging on a password prompt.

To allow it, add a sudoers entry with `sudo visudo -f /etc/sudoers.d/anything`:

```
your-username ALL=(root) NOPASSWD: /usr/bin/powermetrics
```

Understand the trade: this lets anything running as you execute `powermetrics`
as root without a password. `smctemp` is the better option — it needs no
elevated privileges at all. Only reach for this if a helper will not install.

## Fanless Macs

A MacBook Air has no fan. The gauge reads `--` with "Fanless or idle", which is
correct rather than broken. The same text appears when a fan is genuinely
stopped, since the SMC reports both as zero and there is no way to tell them
apart from outside.

## Turning it off

```json
{ "plugins": { "sysmon": { "sensors": false } } }
```

Skips probing entirely and keeps CPU, memory and uptime. Or drop the whole
plugin with `"enabled": false`.

## Poll rate

```json
{ "plugins": { "sysmon": { "pollMs": 5000 } } }
```

Default 2000ms, minimum 500ms. Each poll shells out to the sensor tool, so a
very short interval spends real CPU to report CPU — 2 to 5 seconds is a
sensible range for something you glance at.
