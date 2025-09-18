import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('Connected to AnyThing server');

  // Test button press
  setTimeout(() => {
    console.log('Sending button press...');
    ws.send(JSON.stringify({
      type: 'BUTTON_PRESS',
      payload: { buttonId: 'play' }
    }));
  }, 1000);

  // Test dial rotate
  setTimeout(() => {
    console.log('Sending dial rotate...');
    ws.send(JSON.stringify({
      type: 'DIAL_ROTATE',
      payload: { direction: 'clockwise' }
    }));
  }, 2000);

  // Test touch event
  setTimeout(() => {
    console.log('Sending touch event...');
    ws.send(JSON.stringify({
      type: 'TOUCH',
      payload: { x: 100, y: 100 }
    }));
  }, 3000);
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('close', () => {
  console.log('Disconnected from server');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Cleanup on CTRL+C
process.on('SIGINT', () => {
  console.log('Closing connection...');
  ws.close();
  process.exit(0);
});