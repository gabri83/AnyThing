import styled from 'styled-components';
import { useWebSocket } from './hooks/useWebSocket';
import { NowPlaying } from './components/NowPlaying';
import { Controls } from './components/Controls';

const AppContainer = styled.div`
  width: 480px;
  height: 800px;
  background: #000;
  color: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

export function App() {
  const { connected } = useWebSocket();

  return (
    <AppContainer>
      {!connected ? (
        <div>Connecting to host...</div>
      ) : (
        <>
          <NowPlaying />
          <Controls />
        </>
      )}
    </AppContainer>
  );
}