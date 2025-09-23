# AnyThing — Roadmap

## Guiding Principles
- Build on legal open-source foundations (audit repos at `spsgsb` first).  
- Deliver **early utility** (Apple Music control + macros) to excite users.  
- Grow a **plugin ecosystem** quickly with clear docs and developer love.  
- Keep hardware reuse optional → expand to other devices (e.g. Raspberry Pi with screen).  

---

## Phase 0 — Research & Foundation (Weeks 0-3)
- Audit Spotify open-source repos (`spsgsb`).  
- Decide whether to reuse CarThing firmware/UI code or write a minimal runtime.  
- Define communication protocol (WebSocket vs gRPC).  
- Define Plugin Manifest v1.  

---

## Phase 1 — MVP (Weeks 4-12)
- Deliver usable AnyThing with Apple Music + macros.  
- Provide Server App, Device Runtime, CLI, Apple Music plugin, Macro plugin.  
- Provide documentation and Hello World plugin.  

Notes:
- Completed repo structure fix and working server with WS+HTTP status.
- Input→plugin routing and display updates operational.
- CLI discoverability improved; default configs provided for core plugins.
- Began protocol unification by emitting shared typed PlayerState.

---

## Phase 2 — Beta (Weeks 13-22)
- SDK for plugins.  
- Plugin Gallery.  
- New plugins (Spotify, OBS, Home Assistant).  
- UI improvements (widgets, theming).  
- Simulator for non-CarThing devs.  

Additional next steps proposed:
- Finish adopting shared protocol for all WS messages.
- Wire UI simulator to consume typed messages and render now playing.
- Add RPC for CLI↔server for live status and mapping updates.

---

## Phase 3 — v1.0 Release (Weeks 23-36)
- Stable Plugin API v1.0.  
- Config UI (tray/web).  
- Expanded device support.  
- Plugin Storefront.  
- Full docs + launch marketing.  

---

## Phase 4 — Post-1.0 Expansion
- Voice control.  
- Multi-device sync.  
- Marketplace.  
- Rich UI widgets.  
- Productivity integrations.  
