import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SERVICE_LABEL, servicePlist, serviceUnit, stableNode } from './service';

describe('stableNode', () => {
  it('prefers the PATH entry that points at the running node over a versioned path', () => {
    const root = mkdtempSync(join(tmpdir(), 'anything-node-'));
    try {
      mkdirSync(join(root, 'Cellar', '1.2.3'), { recursive: true });
      mkdirSync(join(root, 'bin'));
      mkdirSync(join(root, 'other'));
      const real = join(root, 'Cellar', '1.2.3', 'node');
      writeFileSync(real, '');
      writeFileSync(join(root, 'other', 'node'), '');
      symlinkSync(real, join(root, 'bin', 'node'));

      const path = [join(root, 'missing'), join(root, 'other'), join(root, 'bin')].join(':');
      expect(stableNode(real, path)).toBe(join(root, 'bin', 'node'));
      expect(stableNode(real, join(root, 'other'))).toBe(real);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('servicePlist', () => {
  const plist = servicePlist({
    node: '/opt/homebrew/bin/node',
    entry: '/Users/me/R&D <x>/server/dist/index.js',
    workingDirectory: '/Users/me/R&D <x>',
    log: '/Users/me/Library/Logs/anything.log'
  });

  it('runs the given node on the given entry file, at login and kept alive', () => {
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it('escapes paths so an odd folder name cannot break the file', () => {
    expect(plist).toContain('<string>/Users/me/R&amp;D &lt;x&gt;/server/dist/index.js</string>');
    expect(plist).not.toContain('R&D');
  });

  it('gives plugins a usable PATH without repeating entries', () => {
    const path = /<key>PATH<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1].split(':') ?? [];
    expect(path[0]).toBe('/opt/homebrew/bin');
    expect(path).toContain('/usr/bin');
    expect(new Set(path).size).toBe(path.length);
  });
});

describe('serviceUnit', () => {
  const unit = serviceUnit({
    node: '/usr/bin/node',
    entry: '/home/me/my "lab" 100%/server/dist/index.js',
    workingDirectory: '/home/me/my "lab" 100%',
    log: ''
  });

  it('is a user service that restarts and starts with the session', () => {
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toMatch(/^Environment=PATH=\/usr\/bin:\/usr\/local\/bin:/m);
  });

  it('quotes the command so spaces, quotes and percent signs survive systemd', () => {
    expect(unit).toContain(
      'ExecStart="/usr/bin/node" "/home/me/my \\"lab\\" 100%%/server/dist/index.js"'
    );
    expect(unit).toContain('WorkingDirectory=/home/me/my "lab" 100%%');
  });
});
