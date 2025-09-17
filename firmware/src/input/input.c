#include <string.h>
#include "nrf.h"
#include "nrf_gpio.h"
#include "app_timer.h"
#include "nrfx_gpiote.h"
#include "nrfx_saadc.h"
#include "input/input.h"
#include "boards.h"

// CarThing hardware pin definitions
#define PIN_BUTTON_BACK      13
#define PIN_BUTTON_PRESET_1  14
#define PIN_BUTTON_PRESET_2  15
#define PIN_BUTTON_PRESET_3  16
#define PIN_BUTTON_PRESET_4  17
#define PIN_BUTTON_DIAL      18

#define PIN_DIAL_A          19  // Rotary encoder phase A
#define PIN_DIAL_B          20  // Rotary encoder phase B

#define PIN_TOUCH_INT       21  // Touch interrupt
#define PIN_TOUCH_RESET     22  // Touch reset
#define PIN_TOUCH_SCL       23  // I2C clock
#define PIN_TOUCH_SDA       24  // I2C data

// Default configuration
static const input_config_t default_config = {
    .button = {
        .debounce_ms = 5,
        .long_press_ms = 500,
        .repeat_start_ms = 600,
        .repeat_interval_ms = 100
    },
    .dial = {
        .steps_per_detent = 4,
        .acceleration = 128
    },
    .touch = {
        .sample_rate_hz = 60,
        .pressure_threshold = 10,
        .long_press_ms = 500,
        .double_tap_ms = 300,
        .swipe_threshold = 50,
        .swipe_velocity = 200
    }
};

// Module state
static struct {
    input_config_t config;
    input_callback_t callback;
    bool initialized;
    uint32_t last_error;
    
    struct {
        uint32_t states;           // Current button states
        uint32_t debounce_time;    // Last debounce time
        uint32_t repeat_time;      // Last repeat time
    } buttons;
    
    struct {
        uint8_t state;            // Current state machine state
        int32_t position;         // Accumulated position
        uint32_t last_time;       // Last update time
        uint8_t acceleration;     // Current acceleration
    } dial;
    
    struct {
        bool active;              // Touch is active
        uint16_t x;              // Current X position
        uint16_t y;              // Current Y position
        uint16_t pressure;       // Current pressure
        uint32_t start_time;     // Touch start time
        uint16_t start_x;        // Touch start X
        uint16_t start_y;        // Touch start Y
        gesture_type_t gesture;  // Current gesture
    } touch;
} input_state;

// Forward declarations
static void input_gpio_init(void);
static void input_timer_init(void);
static void input_touch_init(void);
static void process_buttons(void);
static void process_dial(void);
static void process_touch(void);
static void handle_button_event(button_id_t button, button_state_t state);
static void handle_dial_event(dial_direction_t direction, uint8_t steps);
static void handle_touch_event(touch_event_t event, uint16_t x, uint16_t y, uint16_t pressure);
static void emit_event(const input_event_t *event);

// Initialize input subsystem
ret_code_t input_init(void)
{
    ret_code_t err_code;
    
    // Initialize state
    memset(&input_state, 0, sizeof(input_state));
    input_state.config = default_config;
    
    // Initialize GPIO
    err_code = input_gpio_init();
    if (err_code != NRF_SUCCESS) {
        input_state.last_error = err_code;
        return err_code;
    }
    
    // Initialize timers
    err_code = input_timer_init();
    if (err_code != NRF_SUCCESS) {
        input_state.last_error = err_code;
        return err_code;
    }
    
    // Initialize touch controller
    err_code = input_touch_init();
    if (err_code != NRF_SUCCESS) {
        input_state.last_error = err_code;
        return err_code;
    }
    
    input_state.initialized = true;
    return NRF_SUCCESS;
}

// Initialize GPIO for buttons and dial
static void input_gpio_init(void)
{
    ret_code_t err_code;
    
    // Initialize GPIOTE module
    err_code = nrfx_gpiote_init();
    APP_ERROR_CHECK(err_code);
    
    // Configure buttons
    nrfx_gpiote_in_config_t button_config = NRFX_GPIOTE_CONFIG_IN_SENSE_TOGGLE(true);
    button_config.pull = NRF_GPIO_PIN_PULLUP;
    
    // Back button
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_BACK, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_BACK, true);
    
    // Preset buttons
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_PRESET_1, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_PRESET_1, true);
    
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_PRESET_2, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_PRESET_2, true);
    
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_PRESET_3, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_PRESET_3, true);
    
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_PRESET_4, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_PRESET_4, true);
    
    // Dial button
    err_code = nrfx_gpiote_in_init(PIN_BUTTON_DIAL, &button_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_BUTTON_DIAL, true);
    
    // Configure rotary encoder
    nrfx_gpiote_in_config_t encoder_config = NRFX_GPIOTE_CONFIG_IN_SENSE_TOGGLE(false);
    encoder_config.pull = NRF_GPIO_PIN_PULLUP;
    
    err_code = nrfx_gpiote_in_init(PIN_DIAL_A, &encoder_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_DIAL_A, true);
    
    err_code = nrfx_gpiote_in_init(PIN_DIAL_B, &encoder_config, NULL);
    APP_ERROR_CHECK(err_code);
    nrfx_gpiote_in_event_enable(PIN_DIAL_B, true);
}

// Process input events
void input_process(void)
{
    if (!input_state.initialized) {
        return;
    }
    
    // Process each input type
    process_buttons();
    process_dial();
    process_touch();
}

// Process button inputs
static void process_buttons(void)
{
    // Read current button states
    uint32_t new_states = 0;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_BACK)     << BUTTON_BACK;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_PRESET_1) << BUTTON_PRESET_1;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_PRESET_2) << BUTTON_PRESET_2;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_PRESET_3) << BUTTON_PRESET_3;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_PRESET_4) << BUTTON_PRESET_4;
    new_states |= !nrfx_gpiote_in_is_set(PIN_BUTTON_DIAL)     << BUTTON_DIAL;
    
    uint32_t changed = new_states ^ input_state.buttons.states;
    uint32_t current_time = app_timer_cnt_get();
    
    // Handle debouncing
    if (changed && (current_time - input_state.buttons.debounce_time) >= input_state.config.button.debounce_ms) {
        input_state.buttons.debounce_time = current_time;
        input_state.buttons.states = new_states;
        
        // Emit events for changed buttons
        for (int i = 0; i < BUTTON_COUNT; i++) {
            if (changed & (1 << i)) {
                button_state_t state = (new_states & (1 << i)) ? BUTTON_STATE_PRESSED : BUTTON_STATE_RELEASED;
                handle_button_event(i, state);
            }
        }
    }
    
    // Handle long press and repeat
    for (int i = 0; i < BUTTON_COUNT; i++) {
        if (new_states & (1 << i)) {
            uint32_t hold_time = current_time - input_state.buttons.debounce_time;
            
            // Long press detection
            if (hold_time >= input_state.config.button.long_press_ms) {
                handle_button_event(i, BUTTON_STATE_HELD);
                
                // Auto-repeat
                if (hold_time >= input_state.config.button.repeat_start_ms) {
                    uint32_t repeat_time = current_time - input_state.buttons.repeat_time;
                    if (repeat_time >= input_state.config.button.repeat_interval_ms) {
                        input_state.buttons.repeat_time = current_time;
                        handle_button_event(i, BUTTON_STATE_REPEAT);
                    }
                }
            }
        }
    }
}

// Process rotary encoder
static void process_dial(void)
{
    // Read current encoder state
    uint8_t new_state = 0;
    new_state |= nrfx_gpiote_in_is_set(PIN_DIAL_A) << 0;
    new_state |= nrfx_gpiote_in_is_set(PIN_DIAL_B) << 1;
    
    // State transition table for clockwise rotation:
    // 00 -> 10 -> 11 -> 01 -> 00
    static const int8_t transition_table[4][4] = {
        // 00  01  10  11  <- new state
        {  0,  1, -1,  0 }, // 00 current state
        { -1,  0,  0,  1 }, // 01
        {  1,  0,  0, -1 }, // 10
        {  0, -1,  1,  0 }  // 11
    };
    
    int8_t direction = transition_table[input_state.dial.state][new_state];
    input_state.dial.state = new_state;
    
    if (direction != 0) {
        // Update position and handle acceleration
        uint32_t current_time = app_timer_cnt_get();
        uint32_t delta_time = current_time - input_state.dial.last_time;
        input_state.dial.last_time = current_time;
        
        // Accelerate based on rotation speed
        if (delta_time < 10) {
            input_state.dial.acceleration = MIN(255, input_state.dial.acceleration + 10);
        } else {
            input_state.dial.acceleration = MAX(0, input_state.dial.acceleration - 1);
        }
        
        // Apply acceleration and accumulate position
        int32_t steps = 1 + (input_state.dial.acceleration * input_state.config.dial.acceleration) / 256;
        input_state.dial.position += direction * steps;
        
        // Emit event when we've accumulated enough steps
        if (abs(input_state.dial.position) >= input_state.config.dial.steps_per_detent) {
            dial_direction_t dir = input_state.dial.position > 0 ? DIAL_ROTATION_CW : DIAL_ROTATION_CCW;
            uint8_t detents = abs(input_state.dial.position) / input_state.config.dial.steps_per_detent;
            handle_dial_event(dir, detents);
            input_state.dial.position %= input_state.config.dial.steps_per_detent;
        }
    }
}

// Process touch events
static void process_touch(void)
{
    // TODO: Implement touch panel I2C communication
    // This is a placeholder for the actual touch panel implementation
}

// Handle button event
static void handle_button_event(button_id_t button, button_state_t state)
{
    input_event_t event = {
        .type = INPUT_EVENT_BUTTON,
        .button = {
            .id = button,
            .state = state
        },
        .timestamp = app_timer_cnt_get()
    };
    
    emit_event(&event);
}

// Handle dial event
static void handle_dial_event(dial_direction_t direction, uint8_t steps)
{
    input_event_t event = {
        .type = INPUT_EVENT_DIAL,
        .dial = {
            .direction = direction,
            .steps = steps
        },
        .timestamp = app_timer_cnt_get()
    };
    
    emit_event(&event);
}

// Handle touch event
static void handle_touch_event(touch_event_t event, uint16_t x, uint16_t y, uint16_t pressure)
{
    input_event_t input_event = {
        .type = INPUT_EVENT_TOUCH,
        .touch = {
            .event = event,
            .x = x,
            .y = y,
            .pressure = pressure
        },
        .timestamp = app_timer_cnt_get()
    };
    
    emit_event(&input_event);
}

// Emit event to callback
static void emit_event(const input_event_t *event)
{
    if (input_state.callback) {
        input_state.callback(event);
    }
}

// Register callback
void input_register_callback(input_callback_t callback)
{
    input_state.callback = callback;
}

// Get current configuration
ret_code_t input_get_config(input_config_t *config)
{
    if (!config) {
        return NRF_ERROR_NULL;
    }
    
    *config = input_state.config;
    return NRF_SUCCESS;
}

// Set configuration
ret_code_t input_set_config(const input_config_t *config)
{
    if (!config) {
        return NRF_ERROR_NULL;
    }
    
    input_state.config = *config;
    return NRF_SUCCESS;
}

// Get button state
bool input_is_button_pressed(button_id_t button)
{
    if (button >= BUTTON_COUNT) {
        return false;
    }
    
    return (input_state.buttons.states & (1 << button)) != 0;
}

// Get touch coordinates
uint16_t input_get_touch_x(void)
{
    return input_state.touch.x;
}

uint16_t input_get_touch_y(void)
{
    return input_state.touch.y;
}

uint16_t input_get_touch_pressure(void)
{
    return input_state.touch.pressure;
}

// Power management
void input_suspend(void)
{
    // Disable GPIO interrupts
    for (int i = 0; i < BUTTON_COUNT; i++) {
        nrfx_gpiote_in_event_disable(PIN_BUTTON_BACK + i);
    }
    nrfx_gpiote_in_event_disable(PIN_DIAL_A);
    nrfx_gpiote_in_event_disable(PIN_DIAL_B);
    
    // TODO: Put touch controller in sleep mode
}

void input_resume(void)
{
    // Re-enable GPIO interrupts
    for (int i = 0; i < BUTTON_COUNT; i++) {
        nrfx_gpiote_in_event_enable(PIN_BUTTON_BACK + i, true);
    }
    nrfx_gpiote_in_event_enable(PIN_DIAL_A, true);
    nrfx_gpiote_in_event_enable(PIN_DIAL_B, true);
    
    // TODO: Wake up touch controller
}

// Get last error
uint32_t input_get_last_error(void)
{
    return input_state.last_error;
}