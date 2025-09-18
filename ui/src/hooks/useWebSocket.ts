import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, ConnectionMessage } from '@anything/shared/src/types/protocol';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);

    ws.onopen = () => {
      console.log('Connected to host');
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
        if (!connected && (message.type === 'state' || message.type === 'event')) {
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
      setConnected(false);
      wsRef.current = null;
      
      // Try to reconnect after a delay
      setTimeout(connect, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: Message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send, socket: wsRef.current };
}