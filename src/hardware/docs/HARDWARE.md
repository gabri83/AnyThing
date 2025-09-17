# CarThing Hardware Documentation

## Hardware Specifications

### Display
- Type: IPS LCD
- Resolution: 480 x 800 pixels
- Size: 4.0 inches diagonal
- Interface: MIPI DSI
- Touch: Capacitive touch panel

### Controls
- Rotary Encoder (Dial)
- 4 Physical Buttons
- Back Button
- Preset Buttons (1-4)
- Touch Screen

### Connectivity
- USB Type-C
- Audio Output (3.5mm jack)
- Internal Speaker

### Processor
- Nordic Semiconductor nRF52840
- ARM Cortex-M4F
- 1MB Flash, 256KB RAM
- Bluetooth 5.0

## USB Protocol

### Connection Details
- USB Device Class: Composite Device
  - HID Interface (Controls)
  - Display Interface (Custom Protocol)
  - Audio Interface (UAC2)

### USB Endpoints
1. Control Endpoint (0x00)
   - Standard USB control requests
   - Device configuration

2. HID Endpoint (0x81)
   - Input reports for buttons and dial
   - Touch events

3. Display Endpoint (0x02)
   - Frame buffer updates
   - Display commands

4. Audio Endpoint (0x83)
   - Audio streaming
   - Volume control

### HID Protocol

#### Input Reports
```
Byte 0: Report ID
  0x01: Button Event
  0x02: Dial Event
  0x03: Touch Event

For Button Events (0x01):
Byte 1: Button ID
  0x01: Back Button
  0x02-0x05: Preset Buttons (1-4)
Byte 2: Button State
  0x00: Released
  0x01: Pressed

For Dial Events (0x02):
Byte 1: Rotation Direction
  0x00: Clockwise
  0x01: Counter-clockwise
Byte 2: Steps (uint8)

For Touch Events (0x03):
Bytes 1-2: X coordinate (uint16_le)
Bytes 3-4: Y coordinate (uint16_le)
Byte 5: Touch State
  0x00: Touch End
  0x01: Touch Start
  0x02: Touch Move
```

### Display Protocol

#### Command Format
```
Byte 0: Command ID
  0x01: Full Update
  0x02: Partial Update
  0x03: Display Control
  0x04: Brightness Control

For Full/Partial Update (0x01, 0x02):
Bytes 1-4: Rectangle X, Y, Width, Height
Bytes 5+: Pixel Data (RGB565)

For Display Control (0x03):
Byte 1: Control Command
  0x00: Sleep
  0x01: Wake
  0x02: Reset

For Brightness (0x04):
Byte 1: Brightness Level (0-100)
```

## Software Implementation

### Required Libraries
- `libusb` for USB communication
- `hidapi` for HID interface
- Graphics library (e.g., Cairo) for rendering

### Device Initialization
1. Device Discovery
   ```typescript
   const VID = 0x2786;  // Spotify VID
   const PID = 0x1020;  // CarThing PID
   ```

2. Interface Configuration
   ```typescript
   // Example configuration
   const CONFIG = {
     displayInterface: 0,
     hidInterface: 1,
     audioInterface: 2
   };
   ```

### Display Communication
The display uses RGB565 format:
- 5 bits for red (0-31)
- 6 bits for green (0-63)
- 5 bits for blue (0-31)

## Development Notes

### Known Challenges
1. Display Protocol Timing
   - Requires precise timing for screen updates
   - Need to handle vsync and tearing prevention

2. Touch Calibration
   - May need calibration for accurate touch response
   - Consider saving calibration data

3. Power Management
   - Device can enter sleep mode
   - Need to handle wake-up events properly

### Testing Methodology
1. USB Protocol Testing
   - Use Wireshark with USBPcap
   - Monitor HID reports
   - Validate display updates

2. Display Testing
   - Test different update methods
   - Measure refresh rates
   - Check for artifacts

3. Input Testing
   - Verify all button events
   - Test dial sensitivity
   - Validate touch accuracy

## Next Steps

1. **USB Communication Layer**
   - Implement device discovery
   - Handle USB enumeration
   - Set up endpoint communication

2. **Hardware Abstraction Layer**
   - Create interface definitions
   - Implement event handling
   - Add power management

3. **Display System**
   - Implement frame buffer
   - Add rendering pipeline
   - Handle partial updates

4. **Input Handling**
   - Process HID reports
   - Map hardware events to actions
   - Handle touch gestures