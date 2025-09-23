import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, ConnectionMessage } from '@anything/shared/src/types/protocol';

// Singleton WebSocket across the app to avoid multiple connections/reconnect churn
let sharedSocket: WebSocket | null = null;
let sharedConnected = false;
const sharedListeners = new Set<(connected: boolean) => void>();

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) {
      wsRef.current = sharedSocket;
      setConnected(sharedConnected);
      return;
    }

    const serverBase = (import.meta as any).env.VITE_SERVER_URL || `http://${window.location.hostname}:3000`;
    const wsUrl = serverBase.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to host');
      sharedConnected = true;
      sharedListeners.forEach(l => l(true));
      setConnected(true);
      // Send simple connect message (our protocol)
      const connectMsg: ConnectionMessage = {
        type: 'command',
        target: 'system',
        data: { action: 'connect', client: 'ui' }
      };
      ws.send(JSON.stringify(connectMsg));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Message;
        
        // Handle connection established by marking as connected when we receive first state/event
        if (!sharedConnected && (message.type === 'state' || message.type === 'event')) {
          sharedConnected = true;
          sharedListeners.forEach(l => l(true));
          setConnected(true);
        }
        
        // Handle other messages here
        console.log('Received:', message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from host');
      sharedConnected = false;
      sharedListeners.forEach(l => l(false));
      setConnected(false);
      wsRef.current = null;
      sharedSocket = null;
      
      // Try to reconnect after a delay
      setTimeout(connect, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      // Let close handler manage reconnection
    };

    wsRef.current = ws;
    sharedSocket = ws;
  }, []);

  useEffect(() => {
    sharedListeners.add(setConnected);
    connect();
    return () => {
      sharedListeners.delete(setConnected);
    };
  }, [connect]);

  const send = useCallback((message: Message) => {
    const ws = sharedSocket || wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send, socket: sharedSocket || wsRef.current };
}