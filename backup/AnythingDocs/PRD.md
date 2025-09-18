# 📄 Product Requirements Document (PRD) – AnyThing

## 1. Vision
Transform the discontinued **Spotify CarThing** hardware into an **open platform called AnyThing**, enabling users to control multiple services (Apple Music, Spotify, smart home, productivity tools) and extend functionality via a **plugin ecosystem**. AnyThing will combine the utility of a **media controller** and a **macro pad/stream deck alternative**.

---

## 2. Objectives
- **Primary Goal:** Repurpose CarThing into a multipurpose controller for Apple Music, Spotify, system media, and custom integrations.  
- **Secondary Goal:** Build an **open plugin framework** so developers can extend AnyThing (e.g., OBS control, Home Assistant triggers, Notion shortcuts).  
- **Community Goal:** Foster open source contributions with clear documentation, CLI tools, and a lightweight SDK.  

---

## 3. Key Features (MVP scope)
- 🎵 **Apple Music Integration** – Play/pause, skip, browse playlists, show album art.  
- 🔊 **System Media Control** – Volume, play/pause, skip for any OS-level media.  
- 🎛 **Macro/Shortcut Actions** – Custom keybinds and scripts.  
- 🔌 **Plugin Framework v1** – Developers can add new integrations through a simple API.  
- 🌐 **Server App** – Runs on host machine, communicates with CarThing.  
- 💻 **CLI Tool** – For configuration, plugin management, debugging.  

---

## 4. Non-Goals (for MVP)
- Full-fledged App Store for plugins.  
- Multi-device sync.  
- Advanced voice control.  
- Hardware modifications (we reuse CarThing "as is").  

---

## 5. Users
- **Music lovers** who want to control Apple Music or Spotify easily.  
- **Streamers** needing a cheaper Elgato Stream Deck alternative.  
- **Hackers/Makers** who want to build their own plugins.  

---

## 6. System Architecture
### Components
1. **AnyThing Server**  
   - Core daemon running locally (Linux/Mac/Windows).  
   - Manages hardware input/output.  
   - Provides API for plugins.  
   - Communicates via WebSocket/REST with CarThing.  

2. **Plugin System**  
   - Each plugin = a module exposing metadata + actions.  
   - Example: `applemusic.plugin.js` handles auth + media control.  
   - Plugins sandboxed but can interact via Server API.  

3. **CLI Tool**  
   - Install/uninstall plugins.  
   - Configure mappings (e.g., dial → volume, button → play/pause).  
   - Debug logs and device connection management.  

4. **UI Layer (on CarThing)**  
   - Minimal React-like rendering layer.  
   - Shows plugin UIs (album art, macros, widgets).  

---

## 7. Technical Stack Proposal
- **Server:** Node.js (lightweight, plugin ecosystem friendly).  
- **UI Rendering:** React-lite or Svelte compiled down to a minimal runtime.  
- **Communication:** gRPC or WebSockets between device and server.  
- **Plugins:** NPM-compatible modules with JSON manifest.  
- **Auth:** OAuth2 (Apple Music, Spotify).  

---

## 8. UX & UI Principles
- **Simplicity first** – minimal clutter, big actionable buttons.  
- **Modular widgets** – each plugin can define its widget layout.  
- **Touch + Dial Support** – all interactions optimized for CarThing controls.  

Example UI flows:
- **Apple Music plugin:** Swipe → choose playlist → press to play.  
- **Macro plugin:** Screen shows 4 configurable buttons → triggers OBS scene switch or script.  

---

## 9. Marketing & Community Strategy
- **Open Source, MIT License.**  
- **GitHub-first distribution.**  
- **Dev Docs & Tutorials:** “Build your first plugin in 10 minutes.”  
- **Community Engagement:** Matrix/Discord for devs.  
- **Positioning:** “AnyThing – give your CarThing a second life.”  
- **Messaging:** Highlight freedom vs. Elgato’s walled garden.  

---

## 10. Risks & Mitigation
- **Reverse Engineering Stability:** Relying on unofficial CarThing OS. → Use Nocturne approach, stable abstractions.  
- **Apple Music API Restrictions:** Requires OAuth, limited metadata. → Mitigation: start with basic playback.  
- **Adoption:** Small hardware base. → Broaden scope: allow AnyThing Server + plugin system to run on other displays (e.g., Pi with touch).  
