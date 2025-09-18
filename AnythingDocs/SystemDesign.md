# AnyThing — System Design Specification (SDS)

## 1. Overview
AnyThing transforms the discontinued Spotify CarThing hardware into an **open, extensible controller** for music, macros, and plugins.  

---

## 2. Architecture
- **Device Runtime** (UI + hardware input → WebSocket).  
- **Server App** (plugin management, APIs, config).  
- **Plugin System** (modular extensions).  
- **CLI Tool** (plugin + config management).  

---

## 3. APIs

### Device ↔ Server (WebSocket)
```json
{
  "type": "event",
  "source": "device",
  "payload": { "control": "dial", "action": "rotate", "value": 15 }
}
```

### Plugin ↔ Server (Internal API)
```js
const api = require("anything-api");
api.registerAction("onPlay", () => AppleMusic.play());
api.registerUI("album-art", () => AppleMusic.currentArtwork());
```

### CLI ↔ Server (Local RPC)
- `GET /plugins`  
- `POST /config`  

---

## 4. Data Models
### Plugin Manifest
```json
{
  "name": "apple-music",
  "version": "0.1",
  "description": "Control Apple Music playback",
  "actions": ["play", "pause", "skip"]
}
```

### Config File
```json
{
  "deviceMappings": {
    "button1": "apple-music:play",
    "dial": "system:volume"
  }
}
```

---

## 5. Event Flow Example
**Button Press → Play Apple Music:**
1. Device sends event.  
2. Server checks mapping.  
3. Plugin executes action.  
4. UI updates on device.  

---

## 6. Security
- Sandbox plugins.  
- Validate manifests.  
- Secure local RPC.  

## 7. Protocol (v0 - custom, clean-room)
- Message: `{ type: 'command'|'state'|'event', target?: string, data: any }`
- Music state: `{ status: 'playing'|'paused'|'stopped', track: { title, artist, album, duration, position, artwork? } | null }`
- Commands (music): `play|pause|next|previous|seek(position)`
- Connection: `{ type:'command', target:'system', data:{ action:'connect', client:'ui' } }`

Rationale: intentionally simple to avoid any inherited design/licensing concerns.

## 8. Firmware Strategy (CarThing)
- Goal: custom firmware that boots a minimal runtime (UI + input) and communicates with host over WebSocket.
- Requirements:
  - Safe flashing procedure with rollback (dual-partition if possible)
  - No-brick sequence: verify image, power safety checks, recovery mode
  - Read-only rootfs where feasible, config partition for settings
  - Signed images (developer key for community builds)
- Steps:
  1) Inventory hardware (SoC, RAM/flash, bootloader, peripherals)
  2) Gain shell access in recovery (UART/USB if available)
  3) Extract current OS image, document partition table
  4) Build minimal Linux userspace (BusyBox + Wayland/FB + input)
  5) Implement boot splash, input daemon, WebSocket client
  6) Add A/B update mechanism and recovery
- Risk controls:
  - Dry-run flashing in QEMU/emulator if possible
  - CRC/signature validation before write
  - Keep stock recovery intact; never overwrite bootloader without JTAG plan
