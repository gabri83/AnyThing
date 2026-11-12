import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import {
  definePlugin,
  rotateDelta,
  type HookRequest,
  type HookResponse,
  type ListItem,
  type PluginApi,
  type TileColor
} from '@anything/shared';
import { summarizeTool, toolDetail } from './describe';

/**
 * Claude Code on the device: every session as a row, and — when you switch it
 * on — permission requests answered from the dial instead of the terminal.
 *
 * Claude Code's hooks POST each event to `/hooks/claude-code/event` (see
 * docs/CLAUDE-CODE.md for the settings snippet). Nothing here talks to Claude
 * Code on its own initiative; if the hooks are not installed the page just
 * stays empty.
 */

type Status = 'working' | 'waiting' | 'idle';

interface Session {
  id: string;
  name: string;
  title?: string;
  cwd: string;
  status: Status;
  activity: string;
  tools: number;
  updated: number;
}

/** Claude Code's own hook timeout is set to 300 s in the settings snippet. */
const ANSWER_TIMEOUT_MS = 280_000;
const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

const STATUS_COLOR: Record<Status, TileColor> = {
  working: 'green',
  waiting: 'yellow',
  idle: 'neutral'
};

function stateFile(): string {
  const config = process.env.ANYTHING_CONFIG;
  const dir = config ? dirname(config) : join(homedir(), '.anything');
  return join(dir, 'claude-code.json');
}

/** Whether approvals happen on the device survives a restart of the host. */
function loadApproveHere(fallback: boolean): boolean {
  try {
    const stored = JSON.parse(readFileSync(stateFile(), 'utf8')) as { approveHere?: unknown };
    return typeof stored.approveHere === 'boolean' ? stored.approveHere : fallback;
  } catch {
    return fallback;
  }
}

function saveApproveHere(value: boolean): void {
  try {
    const file = stateFile();
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ approveHere: value }) + '\n', 'utf8');
  } catch {
    // Not being able to remember the switch is not worth failing a press over.
  }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function setup(api: PluginApi): void {
  const sessions = new Map<string, Session>();
  /** Session id -> id of the prompt it is waiting on. */
  const asking = new Map<string, string>();
  let approveHere = loadApproveHere(api.config.approveOnDevice === true);
  let selected: string | null = null;

  const ordered = (): Session[] =>
    [...sessions.values()].sort((a, b) => b.updated - a.updated);

  const render = () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.updated > STALE_SESSION_MS) sessions.delete(id);
    }
    const list = ordered();
    if (!selected || !sessions.has(selected)) selected = list[0]?.id ?? null;

    const items: ListItem[] = list.map((session) => ({
      id: session.id,
      title: session.title ?? session.name,
      subtitle:
        session.id === selected
          ? `${session.activity || 'ready'}\n${session.cwd} · ${session.tools} tool calls · ${ago(session.updated)}`
          : session.activity || 'ready',
      badge: session.status,
      badgeColor: STATUS_COLOR[session.status]
    }));

    const waiting = list.filter((session) => session.status === 'waiting').length;
    const working = list.filter((session) => session.status === 'working').length;

    api.setTiles([
      {
        kind: 'list',
        id: 'sessions',
        w: 6,
        h: 2,
        items,
        selected: selected ?? undefined,
        action: 'select',
        emptyHint: 'No Claude Code sessions yet. Start one and it shows up here.'
      },
      {
        kind: 'toggle',
        id: 'approve-here',
        w: 3,
        label: approveHere ? 'Approvals: on this device' : 'Approvals: in the terminal',
        icon: approveHere ? '✋' : '⌨️',
        on: approveHere,
        color: 'orange',
        action: 'toggle-approve'
      },
      {
        kind: 'text',
        id: 'summary',
        w: 3,
        label: 'Sessions',
        value:
          list.length === 0
            ? 'none'
            : `${list.length} open · ${working} working · ${waiting} waiting`
      }
    ]);
  };

  const sessionFor = (event: Record<string, unknown>): Session => {
    const id = text(event.session_id, 'unknown');
    const cwd = text(event.cwd);
    let session = sessions.get(id);
    if (!session) {
      session = {
        id,
        cwd,
        name: basename(cwd) || 'session',
        status: 'idle',
        activity: '',
        tools: 0,
        updated: Date.now()
      };
      sessions.set(id, session);
    }
    if (cwd) {
      session.cwd = cwd;
      session.name = basename(cwd) || session.name;
    }
    if (typeof event.session_title === 'string') session.title = event.session_title;
    session.updated = Date.now();
    return session;
  };

  /** The session moved on, so whatever it asked was answered somewhere else. */
  const withdraw = (sessionId: string) => {
    const promptId = asking.get(sessionId);
    if (promptId) {
      asking.delete(sessionId);
      api.dismissPrompt(promptId);
    }
  };

  const onEvent = async (request: HookRequest): Promise<HookResponse> => {
    const event =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const name = text(event.hook_event_name);

    if (name === 'SessionEnd') {
      const id = text(event.session_id, 'unknown');
      withdraw(id);
      sessions.delete(id);
      render();
      return {};
    }

    const session = sessionFor(event);
    const tool = text(event.tool_name);

    switch (name) {
      case 'UserPromptSubmit':
        withdraw(session.id);
        session.status = 'working';
        session.activity = 'thinking';
        break;
      case 'PreToolUse':
        withdraw(session.id);
        session.status = 'working';
        session.activity = summarizeTool(tool, event.tool_input);
        session.tools += 1;
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        session.status = 'working';
        break;
      case 'Notification':
        if (event.notification_type === 'permission_prompt') session.status = 'waiting';
        else if (event.notification_type === 'idle_prompt') session.status = 'idle';
        break;
      case 'Stop':
      case 'StopFailure':
        withdraw(session.id);
        session.status = 'idle';
        session.activity = clip(text(event.last_assistant_message).trim(), 200);
        break;
      case 'PermissionRequest': {
        withdraw(session.id);
        session.status = 'waiting';
        session.activity = summarizeTool(tool, event.tool_input);
        render();
        if (!approveHere) return {};

        const promptId = `permission-${session.id}`;
        asking.set(session.id, promptId);
        const choice = await api.prompt(
          {
            source: `${session.title ?? session.name} wants permission`,
            title: session.activity,
            body: toolDetail(tool, event.tool_input),
            choices: [
              { id: 'deny', label: 'Deny', role: 'secondary' },
              { id: 'allow', label: 'Allow', role: 'primary' }
            ]
          },
          { id: promptId, timeoutMs: ANSWER_TIMEOUT_MS }
        );
        if (asking.get(session.id) === promptId) asking.delete(session.id);

        // No answer here means the terminal asks, exactly as without the plugin.
        if (choice !== 'allow' && choice !== 'deny') return {};
        session.status = 'working';
        render();
        return {
          body: {
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision:
                choice === 'allow'
                  ? { behavior: 'allow' }
                  : { behavior: 'deny', message: 'Denied from the AnyThing device.' }
            }
          }
        };
      }
    }

    render();
    return {};
  };

  api.onRequest('event', onEvent);

  api.onAction('select', (payload) => {
    const id = (payload as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && sessions.has(id)) {
      selected = id;
      render();
    }
  });

  api.onAction('move', (payload) => {
    const delta = rotateDelta(payload);
    const list = ordered();
    if (delta === null || list.length === 0) return;
    const index = Math.max(0, list.findIndex((session) => session.id === selected));
    selected = list[Math.min(list.length - 1, Math.max(0, index + delta))].id;
    render();
  });

  api.onAction('toggle-approve', () => {
    approveHere = !approveHere;
    saveApproveHere(approveHere);
    // Switching back to the terminal releases anything waiting on the device.
    if (!approveHere) for (const sessionId of [...asking.keys()]) withdraw(sessionId);
    render();
  });

  api.setControls({ rotate: 'move', presets: ['toggle-approve'] });

  // Keeps "3m ago" honest and ages out sessions that never said goodbye.
  api.every(30_000, render);
}

export default definePlugin({
  manifest: {
    id: 'claude-code',
    name: 'Claude',
    version: '1.0.0',
    description: 'Claude Code sessions, and permission requests answered from the device',
    icon: '✳️',
    defaultConfig: { approveOnDevice: false }
  },
  setup
});
