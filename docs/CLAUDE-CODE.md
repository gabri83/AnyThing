# Claude Code on the device

The bundled `claude-code` plugin shows every Claude Code session on this Mac as
a row — project, whether it is working, waiting on you or idle, and what it is
doing right now — and can put permission requests on the device, so you allow
or deny with the dial instead of going back to the terminal.

## Connecting Claude Code

Claude Code tells the plugin what is happening through **hooks**. Add this to
`~/.claude/settings.json` (merge it with any hooks you already have):

```json
{
  "hooks": {
    "SessionStart":      [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "PostToolUse":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "timeout": 300, "command": "curl -s -m 290 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "Notification":      [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "curl -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }],
    "SessionEnd":        [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/hooks/claude-code/event 2>/dev/null || true" }] }]
  }
}
```

Each hook is one `curl` to the host on loopback. When the host is not running
the call fails at once and silently, and Claude Code behaves exactly as it does
without the hooks. Change the port if you changed `server.port`.

## Approvals

The toggle on the Claude page (or preset button 1 while that page is showing)
chooses where permission requests are answered:

- **In the terminal** (default). The device shows the session as *waiting*;
  the prompt is in the terminal as usual.
- **On this device.** A request takes over the screen with the command or a
  coloured diff. Turn the dial to scroll, press it to allow, press back to
  deny. If nobody answers within about four and a half minutes, the request
  falls through to the terminal.

The choice is remembered across restarts in `~/.anything/claude-code.json`.
Set `plugins.claude-code.approveOnDevice` to `true` to start with it on.

Allowing from the device never overrides a deny or ask rule in your Claude Code
permissions; it only answers the prompt you would otherwise have been shown.

## What it does not do

It cannot send prompts, show a transcript, or stop a session. It reports what
the hooks report and answers permission requests — nothing else.
