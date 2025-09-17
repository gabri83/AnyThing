#include <string.h>
#include "nrf_gpio.h"
#include "nrf_drv_twi.h"
#include "app_timer.h"
#include "nrf_delay.h"
#include "input/touch.h"

// Touch controller I2C address (FT6336U)
#define TOUCH_I2C_ADDR       0x38

// Touch controller registers
#define REG_DEV_MODE        0x00
#define REG_GEST_ID         0x01
#define REG_TD_STATUS       0x02
#define REG_P1_XH          0x03
#define REG_P1_XL          0x04
#define REG_P1_YH          0x05
#define REG_P1_YL          0x06
#define REG_P1_WEIGHT      0x07
#define REG_P1_MISC        0x08
#define REG_P2_XH          0x09
#define REG_THRESHHOLD     0x80
#define REG_CTRL           0x86
#define REG_TIMEENTERMONITOR 0x87
#define REG_PERIODACTIVE   0x88
#define REG_PERIODMONITOR  0x89
#define REG_RADIAN_VALUE   0x91
#define REG_OFFSET_LEFT_RIGHT 0x92
#define REG_OFFSET_UP_DOWN   0x93
#define REG_DISTANCE_LEFT_RIGHT 0x94
#define REG_DISTANCE_UP_DOWN 0x95
#define REG_DISTANCE_ZOOM   0x96
#define REG_LIB_VER_H      0xA1
#define REG_LIB_VER_L      0xA2
#define REG_CIPHER         0xA3
#define REG_FIRMID         0xA6
#define REG_FOCALTECH_ID   0xA8
#define REG_RELEASE_CODE_ID 0xAF

// TWI instance
static const nrf_drv_twi_t m_twi = NRF_DRV_TWI_INSTANCE(0);

// Touch state
static struct {
    bool initialized;
    uint32_t last_error;
    touch_callback_t callback;
    
    struct {
        uint8_t count;
        struct {
            uint16_t x;
            uint16_t y;
            uint8_t pressure;
        } points[2];
    } current;
    
    struct {
        uint16_t x;
        uint16_t y;
        uint32_t time;
    } last_touch;
    
    gesture_state_t gesture;
} touch_state;

// Forward declarations
static ret_code_t touch_i2c_init(void);
static ret_code_t touch_controller_init(void);
static ret_code_t touch_read_register(uint8_t reg, uint8_t *data, uint8_t len);
static ret_code_t touch_write_register(uint8_t reg, uint8_t *data, uint8_t len);
static void touch_process_gestures(void);
static void touch_emit_event(touch_event_type_t type, uint16_t x, uint16_t y, uint8_t pressure);

// Initialize touch subsystem
ret_code_t touch_init(void)
{
    ret_code_t err_code;
    
    // Initialize state
    memset(&touch_state, 0, sizeof(touch_state));
    
    // Initialize I2C
    err_code = touch_i2c_init();
    if (err_code != NRF_SUCCESS) {
        touch_state.last_error = err_code;
        return err_code;
    }
    
    // Initialize touch controller
    err_code = touch_controller_init();
    if (err_code != NRF_SUCCESS) {
        touch_state.last_error = err_code;
        return err_code;
    }
    
    touch_state.initialized = true;
    return NRF_SUCCESS;
}

// Initialize I2C for touch controller
static ret_code_t touch_i2c_init(void)
{
    ret_code_t err_code;
    
    const nrf_drv_twi_config_t config = {
        .scl = PIN_TOUCH_SCL,
        .sda = PIN_TOUCH_SDA,
        .frequency = NRF_DRV_TWI_FREQ_400K,
        .interrupt_priority = APP_IRQ_PRIORITY_HIGH,
        .clear_bus_init = false
    };
    
    err_code = nrf_drv_twi_init(&m_twi, &config, NULL, NULL);
    if (err_code != NRF_SUCCESS) {
        return err_code;
    }
    
    nrf_drv_twi_enable(&m_twi);
    return NRF_SUCCESS;
}

// Initialize touch controller
static ret_code_t touch_controller_init(void)
{
    ret_code_t err_code;
    uint8_t data;
    
    // Reset touch controller
    nrf_gpio_pin_clear(PIN_TOUCH_RESET);
    nrf_delay_ms(5);
    nrf_gpio_pin_set(PIN_TOUCH_RESET);
    nrf_delay_ms(300);
    
    // Read chip ID
    err_code = touch_read_register(REG_FOCALTECH_ID, &data, 1);
    if (err_code != NRF_SUCCESS) {
        return err_code;
    }
    
    if (data != 0x11) {  // FT6336U chip ID
        return NRF_ERROR_NOT_FOUND;
    }
    
    // Configure touch controller
    uint8_t config[] = {
        0x00,  // Normal operating mode
        20,    // Touch threshold
        1,     // Monitor mode switch time
        5,     // Active period
        40     // Monitor period
    };
    
    err_code = touch_write_register(REG_DEV_MODE, &config[0], 1);
    if (err_code != NRF_SUCCESS) return err_code;
    
    err_code = touch_write_register(REG_THRESHHOLD, &config[1], 1);
    if (err_code != NRF_SUCCESS) return err_code;
    
    err_code = touch_write_register(REG_TIMEENTERMONITOR, &config[2], 1);
    if (err_code != NRF_SUCCESS) return err_code;
    
    err_code = touch_write_register(REG_PERIODACTIVE, &config[3], 1);
    if (err_code != NRF_SUCCESS) return err_code;
    
    err_code = touch_write_register(REG_PERIODMONITOR, &config[4], 1);
    if (err_code != NRF_SUCCESS) return err_code;
    
    return NRF_SUCCESS;
}

// Read touch controller register
static ret_code_t touch_read_register(uint8_t reg, uint8_t *data, uint8_t len)
{
    ret_code_t err_code;
    
    err_code = nrf_drv_twi_tx(&m_twi, TOUCH_I2C_ADDR, &reg, 1, true);
    if (err_code != NRF_SUCCESS) {
        return err_code;
    }
    
    err_code = nrf_drv_twi_rx(&m_twi, TOUCH_I2C_ADDR, data, len);
    if (err_code != NRF_SUCCESS) {
        return err_code;
    }
    
    return NRF_SUCCESS;
}

// Write touch controller register
static ret_code_t touch_write_register(uint8_t reg, uint8_t *data, uint8_t len)
{
    uint8_t buffer[len + 1];
    buffer[0] = reg;
    memcpy(&buffer[1], data, len);
    
    return nrf_drv_twi_tx(&m_twi, TOUCH_I2C_ADDR, buffer, len + 1, false);
}

// Process touch events
void touch_process(void)
{
    if (!touch_state.initialized) {
        return;
    }
    
    ret_code_t err_code;
    uint8_t data[15];
    
    // Read touch data
    err_code = touch_read_register(REG_DEV_MODE, data, sizeof(data));
    if (err_code != NRF_SUCCESS) {
        touch_state.last_error = err_code;
        return;
    }
    
    // Parse touch points
    touch_state.current.count = data[REG_TD_STATUS];
    
    if (touch_state.current.count > 0) {
        // Point 1
        touch_state.current.points[0].x = ((data[REG_P1_XH] & 0x0F) << 8) | data[REG_P1_XL];
        touch_state.current.points[0].y = ((data[REG_P1_YH] & 0x0F) << 8) | data[REG_P1_YL];
        touch_state.current.points[0].pressure = data[REG_P1_WEIGHT];
        
        // Point 2 (if available)
        if (touch_state.current.count > 1) {
            touch_state.current.points[1].x = ((data[REG_P2_XH] & 0x0F) << 8) | data[REG_P2_XH + 1];
            touch_state.current.points[1].y = ((data[REG_P2_XH + 2] & 0x0F) << 8) | data[REG_P2_XH + 3];
            touch_state.current.points[1].pressure = data[REG_P2_XH + 4];
        }
        
        // Process gestures
        touch_process_gestures();
        
        // Emit touch event
        touch_emit_event(
            TOUCH_EVENT_MOVE,
            touch_state.current.points[0].x,
            touch_state.current.points[0].y,
            touch_state.current.points[0].pressure
        );
    } else if (touch_state.gesture.active) {
        // Touch released
        touch_state.gesture.active = false;
        touch_emit_event(
            TOUCH_EVENT_UP,
            touch_state.last_touch.x,
            touch_state.last_touch.y,
            0
        );
    }
}

// Process touch gestures
static void touch_process_gestures(void)
{
    uint32_t current_time = app_timer_cnt_get();
    
    if (!touch_state.gesture.active) {
        // New touch sequence
        touch_state.gesture.active = true;
        touch_state.gesture.start_x = touch_state.current.points[0].x;
        touch_state.gesture.start_y = touch_state.current.points[0].y;
        touch_state.gesture.start_time = current_time;
        
        touch_emit_event(
            TOUCH_EVENT_DOWN,
            touch_state.current.points[0].x,
            touch_state.current.points[0].y,
            touch_state.current.points[0].pressure
        );
    } else {
        // Continue gesture
        int16_t dx = touch_state.current.points[0].x - touch_state.gesture.start_x;
        int16_t dy = touch_state.current.points[0].y - touch_state.gesture.start_y;
        uint32_t dt = current_time - touch_state.gesture.start_time;
        
        // Detect swipe gestures
        if (abs(dx) > TOUCH_SWIPE_THRESHOLD || abs(dy) > TOUCH_SWIPE_THRESHOLD) {
            if (abs(dx) > abs(dy)) {
                // Horizontal swipe
                touch_state.gesture.type = dx > 0 ? GESTURE_SWIPE_RIGHT : GESTURE_SWIPE_LEFT;
            } else {
                // Vertical swipe
                touch_state.gesture.type = dy > 0 ? GESTURE_SWIPE_DOWN : GESTURE_SWIPE_UP;
            }
        }
        
        // Detect long press
        else if (dt >= TOUCH_LONG_PRESS_TIMEOUT) {
            touch_emit_event(
                TOUCH_EVENT_LONG_PRESS,
                touch_state.current.points[0].x,
                touch_state.current.points[0].y,
                touch_state.current.points[0].pressure
            );
        }
    }
    
    // Update last touch position
    touch_state.last_touch.x = touch_state.current.points[0].x;
    touch_state.last_touch.y = touch_state.current.points[0].y;
    touch_state.last_touch.time = current_time;
}

// Emit touch event
static void touch_emit_event(touch_event_type_t type, uint16_t x, uint16_t y, uint8_t pressure)
{
    if (touch_state.callback) {
        touch_event_t event = {
            .type = type,
            .x = x,
            .y = y,
            .pressure = pressure,
            .gesture = touch_state.gesture.type,
            .timestamp = app_timer_cnt_get()
        };
        touch_state.callback(&event);
    }
}

// Register callback
void touch_register_callback(touch_callback_t callback)
{
    touch_state.callback = callback;
}

// Get last error
uint32_t touch_get_last_error(void)
{
    return touch_state.last_error;
}

// Enter sleep mode
void touch_sleep(void)
{
    if (!touch_state.initialized) {
        return;
    }
    
    uint8_t mode = 0x03;  // Sleep mode
    touch_write_register(REG_DEV_MODE, &mode, 1);
}

// Exit sleep mode
void touch_wake(void)
{
    if (!touch_state.initialized) {
        return;
    }
    
    uint8_t mode = 0x00;  // Normal mode
    touch_write_register(REG_DEV_MODE, &mode, 1);
    nrf_delay_ms(5);  // Wait for touch controller to wake up
}