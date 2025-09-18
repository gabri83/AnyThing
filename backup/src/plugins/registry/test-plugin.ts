import { Plugin } from '../../types';

const testPlugin: Plugin = {
  name: 'test-plugin',
  version: '0.1.0',
  display: {
    type: 'text',
    content: 'Test Plugin'
  },
  actions: {
    onPress: () => {
      console.log('Test plugin button pressed!');
    }
  }
};

export default testPlugin;