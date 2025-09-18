# AnyThing Firmware

## Overview
Custom firmware for Spotify CarThing hardware. Provides a minimal runtime for UI display and input handling, communicating with the host over WebSocket.

## Safety Requirements

- **NO BRICKING**: Safety is the absolute top priority
- Must have rollback capability
- Must preserve recovery mode
- Must validate all images before flashing

## Development Process

1. Hardware Analysis
   - Document SoC, RAM, flash layout
   - Identify boot sequence and recovery mode
   - Map all I/O (display, dial, buttons, touch)

2. Recovery Access
   - Locate UART/USB debug interfaces
   - Document stock recovery procedures
   - Create emergency restore image

3. Build System
   - Minimal Linux with BusyBox
   - Wayland compositor or direct FB
   - Input handling daemon
   - WebSocket client for host comms

4. Flash Safety
   - A/B partition scheme
   - Checksums and signatures
   - Power-loss recovery
   - DO NOT TOUCH bootloader without JTAG

## Testing

- QEMU/emulator testing where possible
- Hardware-in-loop testing rig
- Stress test power loss scenarios
- Verify all recovery paths

## Building

```bash
# TBD: Build instructions will be added once
# hardware analysis is complete
```

## Flashing

```bash
# TBD: Flash instructions will be added after
# safe flash procedure is verified
```

## Contributing

- Read the safety requirements carefully
- Test thoroughly in emulator first
- Document all hardware findings
- Never assume about boot/flash safety