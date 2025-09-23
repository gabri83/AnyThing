import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { MusicCommandMessage } from '@anything/shared/src/types/protocol';
import { useWebSocket } from '../hooks/useWebSocket';

const Container = styled.div`
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
`;

const Button = styled.button`
  width: 60px;
  height: 60px;
  border-radius: 30px;
  border: none;
  background: #333;
  color: #fff;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background: #444;
  }

  &:active {
    background: #555;
  }
`;

export function Controls() {
  const { send, socket } = useWebSocket();
  const [playerState, setPlayerState] = useState<'playing' | 'paused' | 'stopped'>('stopped');

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'state' && message.target === 'music') {
        setPlayerState(message.data.status);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [socket]);

  const sendControl = (action: 'previous' | 'play' | 'pause' | 'next') => {
    const command: MusicCommandMessage = {
      type: 'command',
      target: 'music',
      data: { action }
    };
    send(command as any);
  };

  return (
    <Container>
      <Button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendControl('previous'); }}>⏮</Button>
      <Button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendControl(playerState === 'playing' ? 'pause' : 'play'); }}>
        {playerState === 'playing' ? '⏸' : '▶'}
      </Button>
      <Button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendControl('next'); }}>⏭</Button>
    </Container>
  );
}