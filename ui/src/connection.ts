import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type InputConfig,
  type Page,
  type PromptsMessage,
  type Tile
} from '@anything/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'denied' | 'offline';

export interface Notice {
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Distinguishes two identical messages so the toast re-animates. */
  key: number;
}

export interface Connection {
  status: ConnectionStatus;
  /** Set when the host refused us, so the UI can say why instead of retrying. */
  deniedReason: string | null;
  pages: Page[];
  notice: Notice | null;
  /** How to read the device's physical controls. Null until the host says. */
  input: InputConfig | null;
  /** Questions awaiting an answer, oldest first. The first one owns the screen. */
  prompts: PromptsMessage['prompts'];
  /** Set when a plugin asks for its page to be shown; `key` changes per request. */
  focus: { plugin: string; key: number } | null;
  invoke: (plugin: string, action: string, payload?: unknown) => void;
  answer: (prompt: string, choice: string) => void;
}

const TOKEN_KEY = 'anything.token';

/**
 * The token arrives in the URL the host prints, then moves to localStorage so
 * a reload or a kiosk restart does not need the query string again. The URL is
 * cleaned up so the token is not left sitting in the address bar.
 */
function resolveToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');

  if (fromUrl) {
    try {
      window.localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // Private browsing or blocked storage: the token still works this session.
    }
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.pathname + url.hash);
    return fromUrl;
  }

  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Backoff in milliseconds, by consecutive failure count. */
function retryDelay(attempt: number): number {
  const schedule = [500, 1000, 2000, 4000, 8000];
  return schedule[Math.min(attempt, schedule.length - 1)];
}

/**
 * One WebSocket for the whole app, with pages applied as the host sends them.
 *
 * The host owns all state, so this holds no optimistic copies: a press is sent
 * and the resulting tiles come back. That keeps the screen honest about what
 * actually happened on the Mac.
 */
export function useConnection(): Connection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [input, setInput] = useState<InputConfig | null>(null);
  const [prompts, setPrompts] = useState<PromptsMessage['prompts']>([]);
  const [focus, setFocus] = useState<{ plugin: string; key: number } | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const retryRef = useRef<number | null>(null);
  const closedForGoodRef = useRef(false);
  const token = useMemo(resolveToken, []);

  const connect = useCallback(() => {
    if (closedForGoodRef.current) return;

    const socket = new WebSocket(socketUrl());
    socketRef.current = socket;
    setStatus((current) => (current === 'open' ? current : 'connecting'));

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          t: 'hello',
          protocol: PROTOCOL_VERSION,
          client: 'device',
          ...(token ? { token } : {})
        })
      );
    };

    socket.onmessage = (event) => {
      const message = parseServerMessage(String(event.data));
      if (!message) return;

      switch (message.t) {
        case 'welcome':
          attemptRef.current = 0;
          setStatus('open');
          setDeniedReason(null);
          setInput(message.input);
          break;

        case 'denied':
          // Retrying with the same bad token would just spin.
          closedForGoodRef.current = true;
          setStatus('denied');
          setDeniedReason(message.message);
          break;

        case 'pages':
          setPages(message.pages);
          break;

        case 'tiles':
          setPages((current) =>
            current.map((page) =>
              page.plugin === message.plugin
                ? { ...page, tiles: message.tiles as Tile[] }
                : page
            )
          );
          break;

        case 'input':
          setInput(message.input);
          break;

        case 'controls':
          setPages((current) =>
            current.map((page) =>
              page.plugin === message.plugin
                ? { ...page, controls: message.controls }
                : page
            )
          );
          break;

        case 'notice':
          setNotice({ level: message.level, message: message.message, key: Date.now() });
          break;

        case 'prompts':
          setPrompts(message.prompts);
          break;

        case 'focus':
          setFocus({ plugin: message.plugin, key: Date.now() });
          break;
      }
    };

    socket.onclose = () => {
      socketRef.current = null;
      // A prompt nobody can answer must not sit on a disconnected screen.
      setPrompts([]);
      if (closedForGoodRef.current) return;
      setStatus('offline');
      const delay = retryDelay(attemptRef.current);
      attemptRef.current += 1;
      retryRef.current = window.setTimeout(connect, delay);
    };

    // onerror is always followed by onclose, which owns the retry.
    socket.onerror = () => {};
  }, [token]);

  useEffect(() => {
    connect();
    return () => {
      closedForGoodRef.current = true;
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  // Clear a toast a few seconds after it lands.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const invoke = useCallback((plugin: string, action: string, payload?: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ t: 'invoke', plugin, action, payload }));
  }, []);

  const answer = useCallback((prompt: string, choice: string) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ t: 'answer', prompt, choice }));
  }, []);

  return { status, deniedReason, pages, notice, input, prompts, focus, invoke, answer };
}
