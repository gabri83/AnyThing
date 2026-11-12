import { basename } from 'path';

/** Turning a Claude Code tool call into something that fits on a small screen. */

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** One line: what the tool call is doing. */
export function summarizeTool(tool: string, toolInput: unknown): string {
  const input = record(toolInput);
  if (tool === 'Bash') {
    const line = input.description ?? input.command;
    return clip(typeof line === 'string' && line ? line : 'shell command', 120);
  }
  for (const key of ['file_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']) {
    const value = input[key];
    if (typeof value === 'string' && value) {
      return clip(`${tool}: ${key === 'file_path' ? basename(value) : value}`, 120);
    }
  }
  return tool || 'tool call';
}

function prefixed(value: unknown, prefix: string): string {
  return String(value ?? '')
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/** Several lines: what exactly is being asked for, shown on the prompt. */
export function toolDetail(tool: string, toolInput: unknown): string {
  const input = record(toolInput);
  if (tool === 'Bash') return clip(String(input.command ?? ''), 4000);
  if ((tool === 'Edit' || tool === 'MultiEdit') && 'old_string' in input) {
    return clip(
      `${input.file_path ?? ''}\n${prefixed(input.old_string, '- ')}\n${prefixed(input.new_string, '+ ')}`,
      4000
    );
  }
  if (tool === 'Write') {
    return clip(`${input.file_path ?? ''}\n${input.content ?? ''}`, 4000);
  }
  return clip(JSON.stringify(input, null, 2), 4000);
}
