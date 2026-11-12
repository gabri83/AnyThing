# On a server

AnyThing does not need a Mac. Plug the Car Thing into a Linux server, run the
host there, and it becomes a status display for that machine: the `prometheus`
plugin shows gauges and firing alerts from the Prometheus the server already
runs.

> The Linux path is newer than the Mac one. The background service and the
> plugin are covered by tests; the Car Thing's USB link has only been run
> against a Mac so far. See "The USB link" below.

## Install

The same line as on a Mac. It needs Node.js 18 or newer, git and an ssh client.

```bash
curl -fsSL https://raw.githubusercontent.com/gabri83/AnyThing/main/install.sh | bash
```

On Linux the host runs as a **systemd user service** (`~/.config/systemd/user/anything.service`),
so nothing needs root. One thing does: a user service stops when its user logs
out unless lingering is on. The installer tries to turn it on and tells you if
it could not; in that case run once:

```bash
sudo loginctl enable-linger "$USER"
```

`anything service`, `anything service logs` (the journal) and `anything update`
work as on a Mac.

## The plugins that make sense

`apple-music` and `macros` are macOS-only and skip themselves. Turn off what you
do not want on the screen:

```bash
anything disable todo
anything disable calendar
anything disable claude-code
```

## The prometheus plugin

It is off until it has a URL. In `~/.anything/config.json`:

```json
"plugins": {
  "prometheus": {
    "url": "http://localhost:9090",
    "alertmanager": "http://localhost:9093"
  }
}
```

| Setting | Default | |
| --- | --- | --- |
| `url` | none | Prometheus. Required |
| `alertmanager` | none | If set, alerts come from here, so silences and inhibitions are respected. Otherwise from Prometheus's own firing alerts |
| `refreshSeconds` | 20 | How often to ask |
| `notify` | true | Interrupt with a full-screen prompt when a new alert starts firing. Alerts already firing when the host starts are not announced |
| `ignoreAlerts` | `["Watchdog"]` | Alert names never shown |
| `metrics` | CPU, memory, root disk | Up to six gauges; three fit a row |

A metric is a label and a PromQL expression that yields one number. If it
yields several series, the highest is shown.

```json
"metrics": [
  { "label": "CPU", "query": "100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[2m])))", "unit": "%", "max": 100, "warnAt": 85 },
  { "label": "CPU temp", "query": "max(node_hwmon_temp_celsius)", "unit": "°C", "max": 100, "warnAt": 80 },
  { "label": "NVMe wear", "query": "max(smartctl_device_percentage_used)", "unit": "%", "max": 100, "warnAt": 80 }
]
```

The dial moves through the alert list; the selected alert shows its summary.
Preset 1 refreshes.

## The USB link

The host reaches the Car Thing over USB networking: the device is `10.42.1.82`
and offers the computer an address by DHCP. A Mac takes it automatically. On
Linux the interface (`usb0` or `enx…`, driver `cdc_ncm`) has to be brought up
with DHCP, which NetworkManager does by itself and a bare server may not. Check
with:

```bash
ip -br addr | grep -E "usb|enx"
ping -c 1 10.42.1.82
anything device
```

If the interface has no address, give it one by DHCP with whatever manages the
network on that machine (netplan, systemd-networkd, NetworkManager).
