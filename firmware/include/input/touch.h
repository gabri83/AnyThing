#ifndef TOUCH_H
#define TOUCH_H

#include <stdint.h>
#include "app_util.h"

// Touch event types
typedef enum {
    TOUCH_EVENT_DOWN,
    TOUCH_EVENT_UP,
    TOUCH_EVENT_MOVE,
    TOUCH_EVENT_LONG_PRESS
} touch_event_type_t;

// Gesture types
typedef enum {
    GESTURE_NONE,
    GESTURE_TAP,
    GESTURE_DOUBLE_TAP,
    GESTURE_SWIPE_LEFT,
    GESTURE_SWIPE_RIGHT,
    GESTURE_SWIPE_UP,
    GESTURE_SWIPE_DOWN,
    GESTURE_PINCH_IN,
    GESTURE_PINCH_OUT
} gesture_type_t;

// Touch event structure
typedef struct {
    touch_event_type_t type;
    uint16_t x;
    uint16_t y;
    uint8_t pressure;
    gesture_type_t gesture;
    uint32_t timestamp;
} touch_event_t;

// Touch gesture state
typedef struct {
    bool active;
    uint16_t start_x;
    uint16_t start_y;
    uint32_t start_time;
    gesture_type_t type;
} gesture_state_t;

// Callback function type
typedef void (*touch_callback_t)(const touch_event_t *event);

// Configuration constants
#define TOUCH_SWIPE_THRESHOLD      50    // Minimum distance for swipe detection
#define TOUCH_LONG_PRESS_TIMEOUT   500   // Time in ms for long press detection
#define TOUCH_DOUBLE_TAP_TIMEOUT   300   // Maximum time between taps
#define TOUCH_MIN_PRESSURE         10    // Minimum pressure for valid touch
#define TOUCH_MAX_PRESSURE         255   // Maximum pressure value

// Initialize touch subsystem
ret_code_t touch_init(void);

// Process touch events
void touch_process(void);

// Register callback for touch events
void touch_register_callback(touch_callback_t callback);

// Power management
void touch_sleep(void);
void touch_wake(void);

// Get last error
uint32_t touch_get_last_error(void);

#endif // TOUCH_H