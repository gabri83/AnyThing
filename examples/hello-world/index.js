/**
 * A complete AnyThing plugin, in plain CommonJS.
 *
 * To run it:
 *   mkdir -p ~/.anything/plugins
 *   cp -r examples/hello-world ~/.anything/plugins/
 *   npm start
 *
 * There is no build step and no dependency on the AnyThing packages: a plugin
 * is an object with a manifest and a setup function. Everything below is done
 * through the `api` the host hands you, and the host cleans up your timers.
 */

module.exports = {
  manifest: {
    id: 'hello-world',
    name: 'Hello',
    version: '1.0.0',
    description: 'The smallest useful plugin: a counter, a switch and a clock',
    // Shown in the page switcher at the top of the screen.
    icon: '⚑',
    // Anything here is overridable from ~/.anything/config.json under
    // plugins["hello-world"], and arrives as api.config.
    defaultConfig: { step: 1 }
  },

  setup(api) {
    const step = Number(api.config.step) || 1;

    let count = 0;
    let loud = false;

    // Called whenever state changes. setTiles replaces this plugin's whole
    // page; the host works out what actually changed before sending anything.
    function render() {
      api.setTiles([
        {
          kind: 'button',
          id: 'bump',
          label: `Count: ${count}`,
          icon: '+',
          color: 'green',
          action: 'bump'
        },
        {
          kind: 'toggle',
          id: 'loud',
          label: 'Loud mode',
          icon: '♪',
          color: 'purple',
          on: loud,
          action: 'toggle-loud'
        },
        {
          kind: 'button',
          id: 'reset',
          label: 'Reset',
          icon: '↻',
          color: 'red',
          // A confirm button arms on the first press and fires on the second.
          confirm: true,
          action: 'reset'
        },
        {
          kind: 'gauge',
          id: 'progress',
          w: 2,
          label: 'Progress to 10',
          value: Math.min(count, 10),
          max: 10,
          sublabel: `${step} per press`
        },
        {
          kind: 'text',
          id: 'clock',
          label: 'Host clock',
          value: new Date().toLocaleTimeString()
        }
      ]);
    }

    // Action ids are referenced by the tiles above. The payload is whatever the
    // tile carried, which is how the seek control on a player tile passes a
    // position.
    api.onAction('bump', () => {
      count += step;
      if (loud) api.notify('info', `Count is now ${count}`);
      render();
    });

    api.onAction('toggle-loud', () => {
      loud = !loud;
      render();
    });

    api.onAction('reset', () => {
      count = 0;
      api.log('counter reset');
      render();
    });

    // Repaint once a second so the clock tile stays current. Use api.every
    // rather than setInterval: the host stops it for you at shutdown.
    api.every(1000, render);
  }
};
