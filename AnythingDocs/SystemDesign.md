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
