import { Plugin, PluginDisplay, PluginActions } from '../types';

// TODO: Implement actual system media control
const systemMediaPlugin: Plugin = {
  name: 'system-media',
  version: '0.1.0',
  display: {
    type: 'text',
    content: 'System Media Controls'
  },
  actions: {
    onPress: () => {
      console.log('Toggle play/pause');
      // TODO: Implement system media play/pause
    },
    onRotate: (direction) => {
      if (direction === 'clockwise') {
        console.log('Volume up');
        // TODO: Implement volume up
      } else {
        console.log('Volume down');
        // TODO: Implement volume down
      }
    }
  }
};

export default systemMediaPlugin;