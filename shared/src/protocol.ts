/**
 * Wire protocol between the host (Mac) and the device (browser).
 *
 * One WebSocket, JSON frames, discriminated on `t`. The server owns all state;
 * the client renders what it is told and reports presses. Keeping the client
 * dumb means a plugin can change its entire layout without a UI release.
 */

import type { ControlBindings, InputConfig } from './controls';
import type { Page } from './tiles';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

/** First frame the client sends. The server replies with `welcome` or `denied`. */
export interface HelloMessage {
  t: 'hello';
  protocol: number;
  /** Free-form client label for the logs, e.g. 'carthing', 'laptop'. */
  client: string;
  /** Required unless the host runs with auth disabled. */
  token?: string;
}

/** A press, rotate, or seek. Routed to the plugin that registered the action. */
export interface InvokeMessage {
  t: 'invoke';
  plugin: string;
  action: string;
  payload?: unknown;
}

export type ClientMessage = HelloMessage | InvokeMessage;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export interface WelcomeMessage {
  t: 'welcome';
  protocol: number;
  host: {
    name: string;
    version: string;
    platform: string;
    arch: string;
  };
  /** How the client should read the device's physical controls. */
  input: InputConfig;
}

/** Auth failed or the protocol version is unsupported. The socket then closes. */
export interface DeniedMessage {
  t: 'denied';
  reason: 'bad-token' | 'protocol-mismatch';
  message: string;
}

/** Full set of pages. Sent on connect and whenever plugins load or unload. */
export interface PagesMessage {
  t: 'pages';
  pages: Page[];
}

/** One plugin's tiles changed. Cheaper than resending every page. */
export interface TilesMessage {
  t: 'tiles';
  plugin: string;
  tiles: Page['tiles'];
}

/** One plugin's control bindings changed. */
export interface ControlsMessage {
  t: 'controls';
  plugin: string;
  controls: ControlBindings;
}

/** Transient message for the client to show, e.g. an action that failed. */
export interface NoticeMessage {
  t: 'notice';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | DeniedMessage
  | PagesMessage
  | TilesMessage
  | ControlsMessage
  | NoticeMessage;

export type AnyMessage = ClientMessage | ServerMessage;

// ---------------------------------------------------------------------------
// Narrowing helpers, used on both ends
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parse a frame and return it only if it is a client message we understand. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  if (value.t === 'hello') {
    if (typeof value.client !== 'string') return null;
    if (typeof value.protocol !== 'number') return null;
    if (value.token !== undefined && typeof value.token !== 'string') return null;
    return {
      t: 'hello',
      protocol: value.protocol,
      client: value.client,
      token: value.token as string | undefined
    };
  }

  if (value.t === 'invoke') {
    if (typeof value.plugin !== 'string') return null;
    if (typeof value.action !== 'string') return null;
    return {
      t: 'invoke',
      plugin: value.plugin,
      action: value.action,
      payload: value.payload
    };
  }

  return null;
}

/** Parse a frame and return it only if it is a server message we understand. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  switch (value.t) {
    case 'welcome':
    case 'denied':
    case 'pages':
    case 'tiles':
    case 'controls':
    case 'notice':
      return value as unknown as ServerMessage;
    default:
      return null;
  }
}
