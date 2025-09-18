import express from 'express';
import cors from 'cors';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import createBonjour from 'bonjour-service';
import { Message, MusicCommandMessage, MusicStateMessage, ConnectionMessage } from '@anything/shared/src/types/protocol';
import { AppleMusicService } from './services/apple-music';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || 'localhost';

// Initialize music service
const musicService = AppleMusicService.getInstance();

// Track update interval (ms)
const TRACK_UPDATE_INTERVAL = 1000;

// Create Express app
const app = express();
app.use(cors());
const uiDistPath = path.resolve(__dirname, '../../ui/dist');
app.use(express.static(uiDistPath)); // Serve UI files

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Broadcast track info to all connected clients using our protocol
async function broadcastTrackInfo() {
  console.log('Broadcasting track info...');
  const track = await musicService.getCurrentTrack();
  const state = await musicService.getPlayerState();

  // Try to prepare artwork URL (served from /artwork endpoint)
  let artworkUrl: string | null = null;
  try {
    const artworkPath = await musicService.getArtwork();
    if (artworkPath) {
      // Cache-bust via timestamp
      artworkUrl = `/artwork?ts=${Date.now()}`;
    }
  } catch (e) {
    console.warn('Artwork not available:', e);
  }
  
  const message: MusicStateMessage = {
    type: 'state',
    target: 'music',
    data: {
      status: state,
      track: track ? {
        title: track.name,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        position: track.position,
        artwork: artworkUrl || undefined,
      } : null,
    }
  };

  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Start track updates
  let trackUpdateInterval: NodeJS.Timeout | null = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString()) as Message;
      console.log('Received:', message);

      // Handle our protocol messages
      if (message.type === 'command') {
        // Connection message
        if (message.target === 'system' && (message as ConnectionMessage).data?.action === 'connect') {
          // Start sending track updates and immediately send current state
          if (!trackUpdateInterval) {
            trackUpdateInterval = setInterval(broadcastTrackInfo, TRACK_UPDATE_INTERVAL);
          }
          await broadcastTrackInfo();
        } else if (message.target === 'music') {
          const { action } = (message as MusicCommandMessage).data as { action: string; position?: number };
          
          switch (action) {
            case 'play':
            case 'pause':
              await musicService.playPause();
              break;
            case 'next':
              await musicService.nextTrack();
              break;
            case 'previous':
              await musicService.previousTrack();
              break;
            case 'seek': {
              const position = (message as MusicCommandMessage).data?.position ?? 0;
              await musicService.seekTo(position);
              break;
            }
          }
          
          // Send immediate track update
          await broadcastTrackInfo();
        }
      }
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (trackUpdateInterval) {
      clearInterval(trackUpdateInterval);
      trackUpdateInterval = null;
    }
  });
});

// Artwork endpoint (serves current track artwork)
app.get('/artwork', async (_req, res) => {
  try {
    const artworkPath = await musicService.getArtwork();
    if (!artworkPath) {
      res.status(404).send('No artwork');
      return;
    }
    res.sendFile(artworkPath);
  } catch (err) {
    console.error('Failed to serve artwork:', err);
    res.status(500).send('Error');
  }
});

// SPA fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(uiDistPath, 'index.html'));
});

// Create HTTP server
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Start mDNS advertisement
const bonjour = new createBonjour();
bonjour.publish({ name: 'anything-host', type: 'ctws', port: PORT, txt: { path: '/ws', proto: '1' } });

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  bonjour.unpublishAll(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});