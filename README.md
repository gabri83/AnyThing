# AnyThing

Transform your Spotify CarThing into an open, multipurpose controller for Apple Music, system media, and more.

## Features

- **Apple Music Integration**: Control Apple Music playback, browse playlists, and view track info
- **System Media Controls**: Control any media playing on your system (Music, Spotify, browsers)
- **Plugin System**: Extend functionality through a simple plugin API
- **Hot-reload Support**: Plugins update automatically when modified
- **Interactive CLI**: Manage plugins and configuration through a user-friendly command line interface

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/AnyThing.git
cd AnyThing

# Install dependencies
npm install

# Build the project
npm run build

# Install CLI globally
npm run cli:link
```

## Usage

### Starting the Server

```bash
npm start
```

### Using the CLI

```bash
# List all plugins
anything plugins

# Configure a plugin
anything plugin:configure apple-music

# Configure server settings
anything server:configure

# Enable/disable plugins
anything plugin:enable apple-music
anything plugin:disable system-media
```

### Plugin Configuration

Each plugin has its own configuration file in `plugins/registry/{plugin-name}.config.json`. Use the CLI to modify these configurations.

## Architecture

### Core Components

- **WebSocket Server**: Handles device connections and event communication
- **Plugin Manager**: Loads and manages plugins with hot-reload support
- **Event System**: Routes device events to appropriate plugins
- **Configuration System**: Manages both global and plugin-specific settings

### Plugins

#### Apple Music Plugin
- Controls Apple Music through AppleScript
- Features: play/pause, next/previous track, volume control
- Shows current track information and playback state

#### System Media Plugin
- Controls system-wide media playback
- Works with multiple media players (Music, Spotify, browsers)
- Features: playback control, volume adjustment, mute toggle

## Development

### Project Structure

```
src/
├── core/           # Core server and application logic
├── plugins/        # Plugin system and implementations
│   ├── registry/   # Plugin files and configurations
│   └── services/   # Shared services used by plugins
├── server/         # WebSocket server implementation
├── cli/            # Command-line interface
├── types/          # TypeScript type definitions
└── tests/          # Test files
```

### Creating a Plugin

Create a new file in `src/plugins/registry` with this structure:

```typescript
import { Plugin, PluginConfig } from '../../types';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '0.1.0',
  display: {
    type: 'text',
    content: 'My Plugin'
  },
  actions: {
    onPress: () => {
      console.log('Button pressed!');
    }
  }
};

export default myPlugin;
```

### Development Commands

```bash
# Start in development mode with hot reload
npm run dev

# Run tests
npm test

# Build the project
npm run build

# Test WebSocket client
npm run test:client

# Start CLI in development mode
npm run cli:dev
```

### Recent Changes (Approach & Edits)

- Build/run fixed by promoting working sources into `src/` and compiling to `dist/`.
- WebSocket server now attaches to an HTTP server; visiting `http://localhost:3000` shows a status page.
- Introduced active plugin handling and input→plugin action routing; server broadcasts plugin display updates.
- CLI linked to `dist` and enhanced to discover plugin configs in `plugins/registry`, `src/plugins/registry`, or `dist/plugins/registry`.
- Added default plugin config files for `apple-music` and `system-media` to make CLI listings visible.
- Began protocol unification: server emits typed music PlayerState messages using `shared` protocol types.
- macOS scope documented: Apple Music and System Media services use AppleScript and require permissions.

Quickstart (updated):

```bash
npm install
npm run build
npm start &   # visit http://localhost:3000

# In another terminal
npm run cli:link
anything plugins
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Future Plans

- [ ] CarThing Hardware Integration
- [ ] Additional Plugins (Spotify, Smart Home)
- [ ] Web Dashboard
- [ ] Custom Themes and Layouts
- [ ] Plugin Marketplace

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.