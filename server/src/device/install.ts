import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Makes a Car Thing start on AnyThing instead of on its firmware's own page.
 *
 * The Bridgething image reads an optional override file before launching its
 * kiosk. Installing writes two things to the device's writable partition: a
 * small splash page, and that override pointing the kiosk at it. The splash
 * waits for the host's tunnel and hands over; with no host it offers the
 * firmware's own interface. Nothing in the firmware itself is modified, and
 * uninstalling removes both files.
 */

const SPLASH_DIR = '/opt/bridgething/anything';
const SPLASH_FILE = `${SPLASH_DIR}/index.html`;
/** The override file the firmware's kiosk launcher sources, if present. */
const KIOSK_ENV = '/opt/bridgething/kiosk-env';
const KIOSK_ENV_BACKUP = `${KIOSK_ENV}.before-anything`;
const MARKER = '# written by AnyThing';

export const SPLASH_URL = `file://${SPLASH_FILE}`;

export interface DeviceInstallStatus {
  reachable: boolean;
  /** The kiosk override points at the AnyThing splash. */
  installed: boolean;
  /** Firmware name and version, when the device said. */
  firmware: string | null;
}

function splashPath(): string {
  return resolve(__dirname, '..', '..', 'assets', 'carthing-splash.html');
}

/** Run a shell script on the device over ssh, optionally feeding it stdin. */
function onDevice(
  address: string,
  script: string,
  stdin?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        '-o', 'ConnectTimeout=5',
        `root@${address}`,
        script
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => done({ code: 255, stdout, stderr: error.message }));
    child.on('close', (code) => done({ code: code ?? 255, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

export async function deviceInstallStatus(address: string): Promise<DeviceInstallStatus> {
  const result = await onDevice(
    address,
    `. /etc/os-release 2>/dev/null; echo "firmware=$PRETTY_NAME"; ` +
      `grep -q '${SPLASH_FILE}' ${KIOSK_ENV} 2>/dev/null && [ -f ${SPLASH_FILE} ] && echo installed=yes || echo installed=no`
  );
  if (result.code !== 0) return { reachable: false, installed: false, firmware: null };
  const firmware = /^firmware=(.*)$/m.exec(result.stdout)?.[1]?.trim() || null;
  return { reachable: true, installed: /^installed=yes$/m.test(result.stdout), firmware };
}

/** Write the splash and the kiosk override. Takes effect at the next boot. */
export async function installOnDevice(address: string): Promise<void> {
  const splash = await readFile(splashPath(), 'utf8');

  const copied = await onDevice(
    address,
    `mkdir -p ${SPLASH_DIR} && cat > ${SPLASH_FILE}.new && mv ${SPLASH_FILE}.new ${SPLASH_FILE}`,
    splash
  );
  if (copied.code !== 0) {
    throw new Error(`Could not copy the splash page to the device: ${copied.stderr.trim()}`);
  }

  // An override somebody else wrote is kept aside, to be restored on uninstall.
  const override = await onDevice(
    address,
    `if [ -f ${KIOSK_ENV} ] && ! grep -q '${MARKER}' ${KIOSK_ENV}; then cp ${KIOSK_ENV} ${KIOSK_ENV_BACKUP}; fi; ` +
      `printf '%s\\n' '${MARKER}; remove this file to start on the firmware page again' ` +
      `'KIOSK_URL=${SPLASH_URL}' > ${KIOSK_ENV}.new && mv ${KIOSK_ENV}.new ${KIOSK_ENV} && sync`
  );
  if (override.code !== 0) {
    throw new Error(`Could not write the kiosk override: ${override.stderr.trim()}`);
  }
}

/** Remove what `installOnDevice` wrote, restoring any earlier override. */
export async function uninstallFromDevice(address: string): Promise<void> {
  const result = await onDevice(
    address,
    `if [ -f ${KIOSK_ENV} ] && grep -q '${MARKER}' ${KIOSK_ENV}; then rm -f ${KIOSK_ENV}; fi; ` +
      `if [ -f ${KIOSK_ENV_BACKUP} ]; then mv ${KIOSK_ENV_BACKUP} ${KIOSK_ENV}; fi; ` +
      `rm -rf ${SPLASH_DIR}; sync`
  );
  if (result.code !== 0) {
    throw new Error(`Could not remove AnyThing from the device: ${result.stderr.trim()}`);
  }
}
