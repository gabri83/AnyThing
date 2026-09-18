#!/usr/bin/env bash
#
# Find a Car Thing attached to this Mac and work out how to point it at the
# AnyThing host.
#
# Nocturne exposes the device as a USB network interface, so it is not an "is
# the cable in" question — the device gets an address, your Mac gets one on the
# same link, and the device can reach a server on your Mac without any Wi-Fi
# involved.
#
# This only looks. It changes nothing on the device, and prints the commands
# that would.
#
#   ./scripts/find-carthing.sh
#
set -uo pipefail

DEVICE_HOSTNAME="nocturne.local"
DEVICE_IP="172.16.42.2"
HOST_IP_GUESS="172.16.42.1"
PORT="${ANYTHING_PORT:-3000}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m+\033[0m %s\n' "$1"; }
no() { printf '  \033[31m-\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

found_any=0
reachable=""

bold "USB"
if command -v system_profiler >/dev/null 2>&1; then
  # The Car Thing presents as an Amlogic/Spotify device, and as a USB network
  # adapter once a custom image is running.
  usb=$(system_profiler SPUSBDataType 2>/dev/null |
    grep -iE 'car thing|superbird|amlogic|spotify|ncm|rndis|cdc' | sed 's/^[[:space:]]*//')
  if [ -n "$usb" ]; then
    found_any=1
    while IFS= read -r line; do ok "$line"; done <<<"$usb"
  else
    no "nothing on USB looks like a Car Thing"
    dim "    Is it plugged into this Mac and powered on?"
  fi
else
  warn "system_profiler not available — is this macOS?"
fi

echo
bold "Network interface"
if command -v ifconfig >/dev/null 2>&1; then
  link=$(ifconfig 2>/dev/null | grep -B 4 "172\.16\.42\." | grep -E '^[a-z]' | cut -d: -f1 | head -1)
  if [ -n "$link" ]; then
    found_any=1
    ok "this Mac is on the device's link via ${link}"
    ifconfig "$link" 2>/dev/null | grep 'inet ' | sed 's/^[[:space:]]*/    /'
  else
    no "no interface on 172.16.42.x"
    dim "    A Nocturne device appears as a USB network adapter. If the device"
    dim "    is booted and this is empty, check System Settings > Network for a"
    dim "    new interface that needs enabling."
  fi
fi

echo
bold "Reaching the device"
for target in "$DEVICE_HOSTNAME" "$DEVICE_IP"; do
  if ping -c 1 -W 1500 "$target" >/dev/null 2>&1; then
    ok "$target answers"
    [ -z "$reachable" ] && reachable="$target"
    found_any=1
  else
    no "$target does not answer"
  fi
done

echo
bold "This Mac's address on that link"
host_ip=""
if [ -n "$reachable" ]; then
  # Ask the routing table which local address would be used to reach the
  # device; that is exactly the address the device must call back on.
  host_ip=$(route -n get "$DEVICE_IP" 2>/dev/null | awk '/interface:/ {print $2}' |
    xargs -I{} ifconfig {} 2>/dev/null | awk '/inet /{print $2; exit}')
fi
if [ -n "$host_ip" ]; then
  ok "$host_ip"
else
  host_ip="$HOST_IP_GUESS"
  warn "could not determine it; the usual value is $host_ip"
fi

echo
bold "Is the AnyThing host running?"
if curl -fsS --max-time 2 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
  ok "yes, on port ${PORT}"
  curl -fsS --max-time 2 "http://localhost:${PORT}/status" 2>/dev/null |
    sed 's/^/    /'
else
  no "nothing answering on localhost:${PORT} — run: npm start"
fi

echo
if [ "$found_any" -eq 0 ]; then
  bold "Nothing found"
  cat <<'EOS'
  Plug the Car Thing into this Mac with a data-capable USB-C cable (a
  charge-only cable will power it and nothing else), give it a few seconds to
  boot, and run this again.
EOS
  exit 1
fi

target="${reachable:-$DEVICE_HOSTNAME}"
url="http://${host_ip}:${PORT}/"

bold "Pointing the device at AnyThing"
cat <<EOS

  The device runs a Chromium kiosk. Change the URL it opens to this host.
  These steps are from the Nocturne community rather than tested here, and the
  file differs between image versions — check both paths.

  1. Get a token for the device:

       node server/dist/cli.js url

  2. SSH in (password: nocturne):

       ssh root@${target}

  3. Make the root filesystem writable:

       mount -o remount,rw /

  4. Find where the kiosk URL is set, and change it to
     ${url}?token=YOUR_TOKEN

       grep -rn "chromium" /etc/supervisord.conf /scripts/ 2>/dev/null

     Older images: the command= line under [program:chromium] in
     /etc/supervisord.conf, usually ending in --app=http://localhost:80
     Newer images: /scripts/chromium_settings.sh

  5. Put it back and restart the kiosk:

       sync && mount -o remount,ro /
       supervisorctl restart chromium

  Note the token goes in the URL only the first time. Before editing anything,
  copy the original line somewhere so you can put it back.

EOS

bold "Check it worked"
cat <<EOS

  Watch the host's terminal. A device that connects prints a line with its
  browser user agent, which tells you exactly which Chromium it runs:

       [ws] device connected (1 total)
       [ws]   Mozilla/5.0 ... Chrome/69.0.3497.128 ...

  If the screen is blank instead, that is usually the browser being older than
  the build targets. Run: npm run check:device

EOS
