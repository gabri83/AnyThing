import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  definePlugin,
  rotateDelta,
  type HookRequest,
  type HookResponse,
  type PluginApi
} from '@anything/shared';

/**
 * A to-do list you tick off with the dial.
 *
 * The device has no keyboard, so items are added from the Mac: `anything todo
 * "Buy milk"`, a POST to `/hooks/todo/add`, or by editing the JSON file, which
 * is re-read when it changes. On the device the dial moves through the list
 * and pressing it ticks the selected item.
 */

interface TodoItem {
  id: string;
  title: string;
  done: boolean;
}

function defaultFile(): string {
  const config = process.env.ANYTHING_CONFIG;
  return join(config ? dirname(config) : join(homedir(), '.anything'), 'todo.json');
}

function isItem(value: unknown): value is TodoItem {
  const item = value as Partial<TodoItem> | null;
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof item.id === 'string' &&
    typeof item.title === 'string'
  );
}

function setup(api: PluginApi): void {
  const file = typeof api.config.file === 'string' && api.config.file ? api.config.file : defaultFile();
  let items: TodoItem[] = [];
  let selected: string | null = null;
  /** mtime of the file as we last read or wrote it, to notice outside edits. */
  let seenMtime = 0;

  const read = () => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      items = Array.isArray(parsed)
        ? parsed.filter(isItem).map((item) => ({ id: item.id, title: item.title, done: item.done === true }))
        : [];
      seenMtime = statSync(file).mtimeMs;
    } catch {
      // No file yet, or one somebody is halfway through editing: keep what we have.
    }
  };

  const write = () => {
    try {
      if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(items, null, 2) + '\n', 'utf8');
      seenMtime = statSync(file).mtimeMs;
    } catch (error) {
      api.warn(`could not save ${file}: ${(error as Error).message}`);
    }
  };

  const render = () => {
    // Open items first, in the order they were added; finished ones sink.
    const ordered = [...items.filter((item) => !item.done), ...items.filter((item) => item.done)];
    if (!selected || !items.some((item) => item.id === selected)) selected = ordered[0]?.id ?? null;
    const left = items.filter((item) => !item.done).length;
    const done = items.length - left;
    const current = items.find((item) => item.id === selected);

    api.setTiles([
      {
        kind: 'list',
        id: 'items',
        w: 6,
        h: 2,
        items: ordered.map((item) => ({
          id: item.id,
          title: item.title,
          icon: item.done ? '✓' : '○',
          done: item.done
        })),
        selected: selected ?? undefined,
        action: 'select',
        emptyHint: 'Nothing to do. Add one on the Mac:  anything todo "Buy milk"'
      },
      {
        kind: 'button',
        id: 'toggle',
        w: 2,
        label: current?.done ? 'Not done' : 'Done',
        icon: current?.done ? '○' : '✓',
        color: 'green',
        action: 'toggle'
      },
      {
        kind: 'button',
        id: 'clear',
        w: 2,
        label: 'Clear finished',
        icon: '🧹',
        action: 'clear-done',
        confirm: true
      },
      {
        kind: 'text',
        id: 'count',
        w: 2,
        label: 'To do',
        value: items.length === 0 ? 'all clear' : `${left} left · ${done} done`
      }
    ]);
  };

  const ordered = (): TodoItem[] => [
    ...items.filter((item) => !item.done),
    ...items.filter((item) => item.done)
  ];

  api.onAction('select', (payload) => {
    const id = (payload as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string') return;
    // Tapping the row that is already selected ticks it, like pressing the dial.
    if (id === selected) {
      const item = items.find((candidate) => candidate.id === id);
      if (item) {
        item.done = !item.done;
        write();
      }
    } else if (items.some((item) => item.id === id)) {
      selected = id;
    }
    render();
  });

  api.onAction('move', (payload) => {
    const delta = rotateDelta(payload);
    const list = ordered();
    if (delta === null || list.length === 0) return;
    const index = Math.max(0, list.findIndex((item) => item.id === selected));
    selected = list[Math.min(list.length - 1, Math.max(0, index + delta))].id;
    render();
  });

  api.onAction('toggle', () => {
    const item = items.find((candidate) => candidate.id === selected);
    if (!item) return;
    item.done = !item.done;
    write();
    render();
  });

  api.onAction('clear-done', () => {
    items = items.filter((item) => !item.done);
    write();
    render();
  });

  api.onRequest('add', (request: HookRequest): HookResponse => {
    const body = request.body as { title?: unknown } | undefined;
    const title = (typeof body?.title === 'string' ? body.title : request.query.title ?? '').trim();
    if (!title) return { status: 400, body: { error: 'Send { "title": "..." }' } };
    const item: TodoItem = { id: randomBytes(4).toString('hex'), title: title.slice(0, 200), done: false };
    items.push(item);
    selected = item.id;
    write();
    render();
    return { body: { added: item } };
  });

  api.onRequest('list', (): HookResponse => ({ body: { items } }));

  // Clearing is touch only: it has a confirm step that a preset press would skip.
  api.setControls({ rotate: 'move', press: 'toggle' });

  read();
  render();

  // Pick up edits made to the file by hand or by another program.
  api.every(2000, () => {
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return;
    }
    if (mtime !== seenMtime) {
      read();
      render();
    }
  });
}

export default definePlugin({
  manifest: {
    id: 'todo',
    name: 'To do',
    version: '1.0.0',
    description: 'A to-do list ticked off with the dial; add items from the Mac',
    icon: '☑'
  },
  setup
});
