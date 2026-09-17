import { useState } from 'react';
import { api } from './client';

/** Mirrors the macros plugin's config shape. Kept loose: it is user-edited JSON. */
export interface MacroDraft {
  id: string;
  label: string;
  type: 'shell' | 'applescript' | 'shortcut' | 'keystroke' | 'open';
  value: string;
  icon?: string;
  color?: string;
  modifiers?: string[];
  confirm?: boolean;
  w?: number;
  h?: number;
}

const TYPES: Array<{ value: MacroDraft['type']; label: string; hint: string }> = [
  { value: 'shell', label: 'Shell command', hint: 'Run with /bin/sh -c' },
  { value: 'applescript', label: 'AppleScript', hint: 'Run with osascript' },
  { value: 'shortcut', label: 'Shortcut', hint: 'Name of a Shortcuts.app shortcut' },
  { value: 'keystroke', label: 'Keystroke', hint: 'A key, sent with the modifiers below' },
  { value: 'open', label: 'Open', hint: 'An app name, file path, or URL' }
];

const COLORS = [
  'neutral',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink'
];

const MODIFIERS = ['command', 'control', 'option', 'shift'] as const;

/** Derive an id from a label, so the field is one less thing to fill in. */
export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'macro';
}

/** Make `base` unique against `taken` by appending a counter. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let counter = 2;
  while (taken.includes(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

/** Problems that would make the host reject or skip a macro. */
export function validateDrafts(drafts: MacroDraft[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Map<string, number>();

  drafts.forEach((draft, index) => {
    if (!draft.label.trim()) {
      errors[index] = 'Needs a label';
    } else if (!draft.value.trim()) {
      errors[index] = 'Needs something to run';
    } else if (!draft.id.trim()) {
      errors[index] = 'Needs an id';
    } else if (seen.has(draft.id)) {
      errors[index] = `Duplicate id "${draft.id}"`;
    }
    seen.set(draft.id, index);
  });

  return errors;
}

export interface MacrosEditorProps {
  macros: MacroDraft[];
  onChange: (macros: MacroDraft[]) => void;
  /** True when the macros plugin is actually loaded, so Test can work. */
  live: boolean;
}

export function MacrosEditor({ macros, onChange, live }: MacrosEditorProps) {
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const errors = validateDrafts(macros);

  const update = (index: number, patch: Partial<MacroDraft>) => {
    onChange(macros.map((macro, i) => (i === index ? { ...macro, ...patch } : macro)));
  };

  const add = () => {
    const id = uniqueId('new-macro', macros.map((macro) => macro.id));
    onChange([
      ...macros,
      { id, label: 'New macro', type: 'shell', value: '', color: 'neutral' }
    ]);
  };

  const remove = (index: number) => {
    onChange(macros.filter((_, i) => i !== index));
  };

  /** Move a macro in the list; the order is the order on the device. */
  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= macros.length) return;
    const next = [...macros];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const test = async (macro: MacroDraft) => {
    setTesting(macro.id);
    setTestResult(null);
    try {
      await api.invoke('macros', macro.id);
      setTestResult(`Ran "${macro.label}"`);
    } catch (error) {
      setTestResult((error as Error).message);
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Macros</h2>
          <p className="panel-sub">
            Each one is a button on the device, in this order. Six fit across a row.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={add}>
          Add macro
        </button>
      </header>

      {macros.length === 0 && (
        <p className="panel-empty">
          No macros yet. Add one and it appears on the device as soon as you save.
        </p>
      )}

      <ul className="macro-list">
        {macros.map((macro, index) => {
          const type = TYPES.find((entry) => entry.value === macro.type);
          const error = errors[index];

          return (
            <li key={`${macro.id}-${index}`} className="macro" data-invalid={Boolean(error) || undefined}>
              <div className="macro-preview" data-color={macro.color ?? 'neutral'}>
                <span className="macro-preview-icon">{macro.icon || '□'}</span>
                <span className="macro-preview-label">{macro.label || 'Untitled'}</span>
              </div>

              <div className="macro-fields">
                <div className="field-row">
                  <label className="field field-grow">
                    <span>Label</span>
                    <input
                      value={macro.label}
                      onChange={(event) => {
                        const label = event.target.value;
                        // Keep the id tracking the label until the macro has a
                        // real one, then leave it alone: the id is what a
                        // device layout refers to.
                        const patch: Partial<MacroDraft> = { label };
                        if (macro.id.startsWith('new-macro')) {
                          patch.id = uniqueId(
                            slugify(label),
                            macros.filter((_, i) => i !== index).map((m) => m.id)
                          );
                        }
                        update(index, patch);
                      }}
                    />
                  </label>

                  <label className="field field-icon">
                    <span>Icon</span>
                    <input
                      value={macro.icon ?? ''}
                      maxLength={2}
                      placeholder="?"
                      onChange={(event) => update(index, { icon: event.target.value })}
                    />
                  </label>

                  <label className="field">
                    <span>Colour</span>
                    <select
                      value={macro.color ?? 'neutral'}
                      onChange={(event) => update(index, { color: event.target.value })}
                    >
                      {COLORS.map((color) => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Type</span>
                    <select
                      value={macro.type}
                      onChange={(event) =>
                        update(index, { type: event.target.value as MacroDraft['type'] })
                      }
                    >
                      {TYPES.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>
                    {macro.type === 'keystroke' ? 'Key' : 'Command'}
                    <em className="field-hint"> — {type?.hint}</em>
                  </span>
                  {macro.type === 'shell' || macro.type === 'applescript' ? (
                    <textarea
                      rows={macro.type === 'applescript' ? 3 : 2}
                      value={macro.value}
                      spellCheck={false}
                      onChange={(event) => update(index, { value: event.target.value })}
                    />
                  ) : (
                    <input
                      value={macro.value}
                      spellCheck={false}
                      onChange={(event) => update(index, { value: event.target.value })}
                    />
                  )}
                </label>

                {macro.type === 'keystroke' && (
                  <div className="field">
                    <span>Modifiers</span>
                    <div className="checks">
                      {MODIFIERS.map((modifier) => (
                        <label key={modifier} className="check">
                          <input
                            type="checkbox"
                            checked={macro.modifiers?.includes(modifier) ?? false}
                            onChange={(event) => {
                              const current = macro.modifiers ?? [];
                              update(index, {
                                modifiers: event.target.checked
                                  ? [...current, modifier]
                                  : current.filter((m) => m !== modifier)
                              });
                            }}
                          />
                          {modifier}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="macro-foot">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={macro.confirm ?? false}
                      onChange={(event) => update(index, { confirm: event.target.checked })}
                    />
                    Ask twice before running
                  </label>

                  <label className="check">
                    <span>Width</span>
                    <select
                      value={macro.w ?? 1}
                      onChange={(event) => update(index, { w: Number(event.target.value) })}
                    >
                      {[1, 2, 3, 4, 5, 6].map((width) => (
                        <option key={width} value={width}>
                          {width}
                        </option>
                      ))}
                    </select>
                  </label>

                  <span className="macro-id">id: {macro.id}</span>

                  <div className="macro-actions">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="Move up"
                    >
                      {'↑'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={index === macros.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move down"
                    >
                      {'↓'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!live || testing === macro.id}
                      title={
                        live
                          ? 'Run it now, as saved on the host'
                          : 'The macros plugin is not loaded on this host'
                      }
                      onClick={() => test(macro)}
                    >
                      {testing === macro.id ? 'Running...' : 'Test'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => remove(index)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {error && <p className="field-error">{error}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {testResult && (
        <p className="run-result" role="status">
          {testResult}
        </p>
      )}

      <p className="panel-note">
        Test runs the version currently saved on the host, not unsaved edits —
        save first, then test.
      </p>
    </section>
  );
}
