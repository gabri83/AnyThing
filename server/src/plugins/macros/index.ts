import { definePlugin, type PluginApi, type Tile, type TileColor } from '@anything/shared';
import { configPath } from '../../config';
import { run, runAppleScript } from '../../osascript';

/**
 * How a macro does its work.
 *
 *   shell        `value` is run with /bin/sh -c
 *   applescript  `value` is run with osascript
 *   shortcut     `value` names a Shortcuts.app shortcut
 *   keystroke    `value` is a key, sent with `modifiers`
 *   open         `value` is an app name, file, or URL, handed to `open`
 */
export type MacroType = 'shell' | 'applescript' | 'shortcut' | 'keystroke' | 'open';

export const MACRO_TYPES: MacroType[] = [
  'shell',
  'applescript',
  'shortcut',
  'keystroke',
  'open'
];

export type KeyModifier = 'command' | 'control' | 'option' | 'shift';

const MODIFIERS: KeyModifier[] = ['command', 'control', 'option', 'shift'];

export interface Macro {
  id: string;
  label: string;
  type: MacroType;
  value: string;
  icon?: string;
  color?: TileColor;
  /** For type 'keystroke'. */
  modifiers?: KeyModifier[];
  /** Require a second press to fire. Worth setting on anything destructive. */
  confirm?: boolean;
  /** Grid width in columns, 1-6. */
  w?: number;
  /** Grid height in rows, 1-3. */
  h?: number;
}

export interface MacroValidation {
  valid: Macro[];
  /** Human-readable reason per rejected entry, for the log and the screen. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the configured macro list. Bad entries are collected rather than
 * thrown: one typo in a config file should cost the user that button, not the
 * whole plugin.
 */
export function validateMacros(raw: unknown): MacroValidation {
  const valid: Macro[] = [];
  const errors: string[] = [];

  if (raw === undefined) return { valid, errors };
  if (!Array.isArray(raw)) {
    return { valid, errors: ['"macros" must be an array'] };
  }

  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const where = `macro #${index + 1}`;

    if (!isRecord(entry)) {
      errors.push(`${where}: not an object`);
      return;
    }
    const { id, label, type, value } = entry;

    if (typeof id !== 'string' || id.trim() === '') {
      errors.push(`${where}: missing "id"`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${where}: duplicate id "${id}"`);
      return;
    }
    if (typeof label !== 'string' || label.trim() === '') {
      errors.push(`${id}: missing "label"`);
      return;
    }
    if (typeof type !== 'string' || !MACRO_TYPES.includes(type as MacroType)) {
      errors.push(`${id}: "type" must be one of ${MACRO_TYPES.join(', ')}`);
      return;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${id}: missing "value"`);
      return;
    }

    let modifiers: KeyModifier[] | undefined;
    if (entry.modifiers !== undefined) {
      if (!Array.isArray(entry.modifiers)) {
        errors.push(`${id}: "modifiers" must be an array`);
        return;
      }
      const unknown = entry.modifiers.filter(
        (m) => typeof m !== 'string' || !MODIFIERS.includes(m as KeyModifier)
      );
      if (unknown.length > 0) {
        errors.push(
          `${id}: unknown modifier(s) ${unknown.join(', ')} ` +
            `(use ${MODIFIERS.join(', ')})`
        );
        return;
      }
      modifiers = entry.modifiers as KeyModifier[];
    }

    seen.add(id);
    valid.push({
      id,
      label,
      type: type as MacroType,
      value,
      icon: typeof entry.icon === 'string' ? entry.icon : undefined,
      color: typeof entry.color === 'string' ? (entry.color as TileColor) : undefined,
      modifiers,
      confirm: entry.confirm === true,
      w: typeof entry.w === 'number' ? entry.w : undefined,
      h: typeof entry.h === 'number' ? entry.h : undefined
    });
  });

  return { valid, errors };
}

/** AppleScript to press a key with modifiers, via System Events. */
export function keystrokeScript(key: string, modifiers: KeyModifier[] = []): string {
  const using =
    modifiers.length > 0
      ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
      : '';
  // Escape for an AppleScript string literal.
  const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "System Events" to keystroke "${escaped}"${using}`;
}

async function execute(macro: Macro): Promise<void> {
  switch (macro.type) {
    case 'shell':
      // The macro list is the user's own config file, and the network path to
      // it is token-gated (see config.auth). Shell semantics are the point of
      // this macro type, so the string goes to a shell intentionally.
      await run('/bin/sh', ['-c', macro.value], 15_000);
      return;
    case 'applescript':
      await runAppleScript(macro.value, 15_000);
      return;
    case 'shortcut':
      await run('/usr/bin/shortcuts', ['run', macro.value], 30_000);
      return;
    case 'keystroke':
      await runAppleScript(keystrokeScript(macro.value, macro.modifiers));
      return;
    case 'open':
      await run('/usr/bin/open', [macro.value], 10_000);
      return;
  }
}

function macroTile(macro: Macro): Tile {
  return {
    kind: 'button',
    id: macro.id,
    label: macro.label,
    icon: macro.icon,
    color: macro.color,
    action: macro.id,
    confirm: macro.confirm,
    w: macro.w,
    h: macro.h
  };
}

/** Shown on first run, when no macros are configured yet. */
function emptyStateTiles(path: string): Tile[] {
  return [
    {
      kind: 'text',
      id: 'empty',
      w: 6,
      h: 1,
      label: 'No macros yet',
      value: `Add a "macros" array under plugins["macros"] in ${path}`
    }
  ];
}

export default definePlugin({
  manifest: {
    id: 'macros',
    name: 'Macros',
    version: '1.0.0',
    description: 'Run shell commands, AppleScript, Shortcuts and keystrokes',
    icon: '▣',
    platforms: ['darwin'],
    defaultConfig: { macros: [] }
  },

  setup(api: PluginApi) {
    const { valid, errors } = validateMacros(api.config.macros);

    for (const error of errors) api.warn(`config: ${error}`);

    for (const macro of valid) {
      api.onAction(macro.id, async () => {
        api.log(`running ${macro.id} (${macro.type})`);
        await execute(macro);
      });
    }

    const tiles: Tile[] =
      valid.length === 0 && errors.length === 0
        ? emptyStateTiles(configPath())
        : valid.map(macroTile);

    // Surface config mistakes on the device too; the user is holding the
    // screen, not watching the host's terminal.
    if (errors.length > 0) {
      tiles.push({
        kind: 'text',
        id: 'config-errors',
        w: 6,
        color: 'red',
        label: `${errors.length} macro(s) skipped`,
        value: errors.join(' | ')
      });
    }

    api.setTiles(tiles);
  }
});
