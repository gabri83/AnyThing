import http from 'http';
import { WebSocket } from 'ws';

/**
 * The few Chrome DevTools Protocol calls needed to steer a kiosk browser:
 * ask what page it is showing, and send it somewhere else.
 *
 * Each call opens its own short-lived connection. The kiosk is asked a
 * question every few seconds at most, and a connection held open would have
 * to be nursed through every unplug and browser restart.
 */

interface PageTarget {
  id: string;
  type: string;
  url: string;
}

function listTargets(port: number, timeoutMs: number): Promise<PageTarget[]> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: timeoutMs },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(body) as PageTarget[]);
          } catch (error) {
            reject(error as Error);
          }
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', reject);
  });
}

/** Run one CDP command against the kiosk's page and return its result. */
async function call(
  port: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 4000
): Promise<Record<string, unknown>> {
  const page = (await listTargets(port, timeoutMs)).find((target) => target.type === 'page');
  if (!page) throw new Error('kiosk browser has no page');

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${page.id}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('timed out'));
    }, timeoutMs);
    const finish = (error: Error | null, result?: Record<string, unknown>) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(result ?? {});
    };

    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message: string };
      };
      if (message.id !== 1) return;
      finish(message.error ? new Error(message.error.message) : null, message.result);
    });
    socket.on('error', (error) => finish(error));
  });
}

/** URL the kiosk is showing, or null when the browser cannot be reached. */
export async function kioskUrl(port: number): Promise<string | null> {
  try {
    const result = await call(port, 'Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Point the kiosk at `url`. Returns false when the browser cannot be reached. */
export async function kioskNavigate(port: number, url: string): Promise<boolean> {
  try {
    await call(port, 'Page.navigate', { url });
    return true;
  } catch {
    return false;
  }
}

/** PNG screenshot of the kiosk, for checking what is really on the screen. */
export async function kioskScreenshot(port: number): Promise<Buffer | null> {
  try {
    const result = await call(port, 'Page.captureScreenshot', { format: 'png' }, 8000);
    return typeof result.data === 'string' ? Buffer.from(result.data, 'base64') : null;
  } catch {
    return null;
  }
}
