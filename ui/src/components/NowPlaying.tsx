import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useWebSocket } from '../hooks/useWebSocket';

const Container = styled.div`
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const Artwork = styled.div`
  width: 300px;
  height: 300px;
  background: #333;
  margin-bottom: 20px;
  background-size: cover;
  background-position: center;
  border-radius: 8px;
`;

const Title = styled.h1`
  font-size: 24px;
  margin: 0 0 10px 0;
  text-align: center;
`;

const Artist = styled.h2`
  font-size: 18px;
  color: #999;
  margin: 0;
  text-align: center;
`;

const Album = styled.h3`
  font-size: 16px;
  color: #666;
  margin: 10px 0;
  text-align: center;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 8px;
  background: #333;
  margin-top: 20px;
  position: relative;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #1DB954;
  transition: width 0.1s ease-out;
`;

interface Track {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  artworkUrl?: string | null;
}


export function NowPlaying() {
  const { send, socket } = useWebSocket();
  const [track, setTrack] = useState<Track | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'state' && message.target === 'music') {
        setTrack(message.data.track);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [socket]);

  const displayTitle = track ? track.title : 'Not playing';
  const progressPct = track && track.duration > 0 ? Math.min(100, Math.max(0, (track.position / track.duration) * 100)) : 0;

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!track || track.duration <= 0) return;
    const rect = (e.target as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const newPos = Math.max(0, Math.min(track.duration, pct * track.duration));
    send({
      type: 'command',
      target: 'music',
      data: { action: 'seek', position: newPos }
    } as any);
  };

  return (
    <Container>
      <Artwork style={track?.artworkUrl ? { backgroundImage: `url(${track.artworkUrl})` } : undefined} />
      <Title>{displayTitle}</Title>
      {track?.artist && <Artist>{track.artist}</Artist>}
      {track?.album && <Album>{track.album}</Album>}
      <ProgressBar onClick={onSeek}>
        <ProgressFill style={{ width: `${progressPct}%` }} />
      </ProgressBar>
    </Container>
  );
}