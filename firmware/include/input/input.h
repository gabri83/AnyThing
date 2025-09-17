#ifndef INPUT_H
#define INPUT_H

#include <stdint.h>
#include "app_util.h"

// Input event types
typedef enum {
    INPUT_EVENT_BUTTON,
    INPUT_EVENT_DIAL,
    INPUT_EVENT_TOUCH,
    INPUT_EVENT_GESTURE
} input_event_type_t;

// Button IDs matching CarThing hardware
typedef enum {
    BUTTON_BACK = 0,    // Back button
    BUTTON_PRESET_1,    // Preset button 1
    BUTTON_PRESET_2,    // Preset button 2
    BUTTON_PRESET_3,    // Preset button 3
    BUTTON_PRESET_4,    // Preset button 4
    BUTTON_DIAL,        // Dial press
    BUTTON_COUNT
} button_id_t;

// Button states
typedef enum {
    BUTTON_STATE_RELEASED = 0,
    BUTTON_STATE_PRESSED,
    BUTTON_STATE_HELD,      // Held for long press threshold
    BUTTON_STATE_REPEAT     // Auto-repeat while held
} button_state_t;

// Dial rotation direction
typedef enum {
    DIAL_ROTATION_CW = 0,   // Clockwise
    DIAL_ROTATION_CCW       // Counter-clockwise
} dial_direction_t;

// Touch event types
typedef enum {
    TOUCH_EVENT_DOWN = 0,
    TOUCH_EVENT_UP,
    TOUCH_EVENT_MOVE,
    TOUCH_EVENT_LONG_PRESS
} touch_event_t;

// Gesture types
typedef enum {
    GESTURE_NONE = 0,
    GESTURE_TAP,
    GESTURE_DOUBLE_TAP,
    GESTURE_SWIPE_LEFT,
    GESTURE_SWIPE_RIGHT,
    GESTURE_SWIPE_UP,
    GESTURE_SWIPE_DOWN
} gesture_type_t;

// Input event structure
typedef struct {
    input_event_type_t type;
    union {
        struct {
            button_id_t id;
            button_state_t state;
        } button;
        struct {
            dial_direction_t direction;
            uint8_t steps;
        } dial;
        struct {
            touch_event_t event;
            uint16_t x;
            uint16_t y;
            uint16_t pressure;
        } touch;
        struct {
            gesture_type_t type;
            uint16_t x;
            uint16_t y;
        } gesture;
    };
    uint32_t timestamp;
} input_event_t;

// Input configuration
typedef struct {
    struct {
        uint16_t debounce_ms;        // Button debounce time
        uint16_t long_press_ms;      // Long press threshold
        uint16_t repeat_start_ms;    // Time before auto-repeat starts
        uint16_t repeat_interval_ms; // Auto-repeat interval
    } button;
    
    struct {
        uint8_t steps_per_detent;    // Encoder steps per detent
        uint8_t acceleration;        // 0-255, higher = more acceleration
    } dial;
    
    struct {
        uint16_t sample_rate_hz;     // Touch panel sample rate
        uint16_t pressure_threshold;  // Minimum pressure for touch
        uint16_t long_press_ms;      // Long press threshold
        uint16_t double_tap_ms;      // Maximum time between taps
        uint16_t swipe_threshold;    // Minimum distance for swipe
        uint16_t swipe_velocity;     // Minimum velocity for swipe
    } touch;
} input_config_t;

// Callback function types
typedef void (*input_callback_t)(const input_event_t *event);

// Initialize input subsystem
ret_code_t input_init(void);

// Process input events
void input_process(void);

// Register callback for input events
void input_register_callback(input_callback_t callback);

// Configuration
ret_code_t input_get_config(input_config_t *config);
ret_code_t input_set_config(const input_config_t *config);

// Calibration
ret_code_t input_calibrate_touch(void);
ret_code_t input_calibrate_dial(void);

// Status
bool input_is_button_pressed(button_id_t button);
uint16_t input_get_touch_x(void);
uint16_t input_get_touch_y(void);
uint16_t input_get_touch_pressure(void);

// Power management
void input_suspend(void);
void input_resume(void);

// Diagnostics
uint32_t input_get_last_error(void);

#endif // INPUT_H