# CarThing Firmware

## Hardware Platform

The Spotify CarThing uses the following hardware:
- Nordic Semiconductor nRF52840 (ARM Cortex-M4F)
- 4" IPS LCD Display (480x800)
- Capacitive Touch Panel
- Rotary Encoder
- 4 Physical Buttons
- USB Type-C for power and communication

## Firmware Architecture

### Current Spotify Firmware
The CarThing runs a custom firmware based on the Nordic SDK, which:
1. Implements USB CDC (Communications Device Class)
2. Handles display updates
3. Manages touch input
4. Controls physical buttons and dial
5. Handles power management

### AnyThing Custom Firmware

Our custom firmware will:
1. Replace the Spotify-specific functionality
2. Maintain hardware compatibility
3. Add our custom protocol support
4. Enable plugin-driven display updates

## Development Environment

### Prerequisites
- Nordic SDK v17.1.0
- ARM GCC Toolchain
- nRF Command Line Tools
- J-Link or compatible programmer

### Project Structure
```
firmware/
├── src/
│   ├── main.c              # Main application entry
│   ├── usb/               # USB communication
│   ├── display/           # Display driver
│   ├── input/            # Input handling
│   ├── power/            # Power management
│   └── protocol/         # AnyThing protocol
├── include/              # Header files
├── lib/                  # Third-party libraries
└── sdk_config.h         # Nordic SDK configuration
```

## Flashing Process

1. Enter DFU Mode:
   - Hold button 1 while connecting USB
   - Device appears as "CarThing DFU"

2. Flash firmware:
   ```bash
   nrfjprog --program firmware.hex --chiperase
   ```

3. Verify installation:
   ```bash
   nrfjprog --verify firmware.hex
   ```

## Protocol Implementation

### USB Protocol
```c
typedef struct {
    uint8_t command;
    uint16_t length;
    uint8_t data[];
} usb_packet_t;
```

### Display Updates
```c
typedef struct {
    uint16_t x;
    uint16_t y;
    uint16_t width;
    uint16_t height;
    uint16_t pixels[];
} display_update_t;
```

### Input Events
```c
typedef struct {
    uint8_t type;    // BUTTON, DIAL, TOUCH
    uint8_t code;    // Button ID, rotation, etc.
    uint16_t value;  // Press/release, steps, coordinates
} input_event_t;
```

## Security Considerations

1. USB Protocol
   - Validate packet length and checksums
   - Buffer overflow protection
   - Command validation

2. Display Updates
   - Validate coordinates
   - Memory bounds checking
   - Proper buffer management

3. Power Management
   - Watchdog timer
   - Brown-out detection
   - USB power monitoring

## Development Phases

1. **Basic Firmware** 🚧
   - USB communication
   - Simple display updates
   - Basic input handling

2. **Core Features** 🔜
   - Full display driver
   - Touch calibration
   - Power management

3. **Protocol Support** 🔜
   - AnyThing protocol
   - Plugin support
   - State management

4. **Optimization** 🔜
   - Display update optimization
   - Power consumption
   - Response time

## Building

```bash
# Setup development environment
./setup_env.sh

# Configure for CarThing
cmake -B build -DBOARD=carthing

# Build firmware
cmake --build build

# Create firmware package
cmake --build build --target package
```

## Testing

```bash
# Run unit tests
cmake --build build --target test

# Run hardware tests
./test/hardware_test.sh
```

## Debugging

1. Using J-Link:
   ```bash
   JLinkGDBServer -device nRF52840_xxAA
   arm-none-eabi-gdb build/firmware.elf
   ```

2. USB Debugging:
   ```bash
   # Monitor USB traffic
   sudo usbmon
   ```

3. Display Testing:
   ```bash
   # Test patterns
   ./tools/display_test.py
   ```

## Known Issues

1. Display
   - Tearing during full updates
   - Need vsync implementation

2. Touch
   - Calibration drift
   - Edge detection issues

3. USB
   - Occasional disconnect under heavy load
   - Need better error recovery

## Next Steps

1. **Initial Implementation**
   - Basic USB communication
   - Display initialization
   - Input event handling

2. **Protocol Layer**
   - Implement AnyThing protocol
   - Add state management
   - Error handling

3. **Optimization**
   - Display update speed
   - Touch responsiveness
   - Power efficiency