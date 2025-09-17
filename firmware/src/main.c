#include <stdbool.h>
#include <stdint.h>
#include "nrf.h"
#include "nrf_gpio.h"
#include "nrf_delay.h"
#include "boards.h"
#include "app_util.h"
#include "nrf_usbd.h"
#include "app_error.h"

#include "usb/usb.h"
#include "display/display.h"
#include "input/input.h"
#include "power/power.h"
#include "protocol/protocol.h"

// System state
static volatile bool system_initialized = false;
static volatile bool usb_connected = false;

// Forward declarations
static void system_init(void);
static void error_handler(uint32_t error_code);

int main(void)
{
    // Initialize system
    system_init();
    
    // Main loop
    while (true)
    {
        // Handle USB events
        usb_process();
        
        // Handle input events
        input_process();
        
        // Handle display updates
        display_process();
        
        // Handle power management
        power_process();
        
        // Handle protocol events
        protocol_process();
        
        // Enter sleep if possible
        if (power_can_sleep())
        {
            power_enter_sleep();
        }
    }
}

static void system_init(void)
{
    // Initialize board hardware
    nrf_gpio_cfg_output(LED_1);
    nrf_gpio_cfg_output(LED_2);
    
    // Initialize subsystems
    ret_code_t err_code;
    
    // Initialize power management
    err_code = power_init();
    APP_ERROR_CHECK(err_code);
    
    // Initialize USB
    err_code = usb_init();
    APP_ERROR_CHECK(err_code);
    
    // Initialize display
    err_code = display_init();
    APP_ERROR_CHECK(err_code);
    
    // Initialize input system
    err_code = input_init();
    APP_ERROR_CHECK(err_code);
    
    // Initialize protocol handler
    err_code = protocol_init();
    APP_ERROR_CHECK(err_code);
    
    // Register system callbacks
    power_register_callback(system_power_callback);
    usb_register_callback(system_usb_callback);
    protocol_register_callback(system_protocol_callback);
    
    // Signal initialization complete
    nrf_gpio_pin_set(LED_1);
    system_initialized = true;
}

// Callback handlers
static void system_power_callback(power_event_t event)
{
    switch (event)
    {
        case POWER_EVENT_SLEEP_ENTER:
            display_suspend();
            break;
            
        case POWER_EVENT_SLEEP_EXIT:
            display_resume();
            break;
            
        case POWER_EVENT_USB_POWER_CONNECTED:
            usb_connected = true;
            nrf_gpio_pin_set(LED_2);
            break;
            
        case POWER_EVENT_USB_POWER_DISCONNECTED:
            usb_connected = false;
            nrf_gpio_pin_clear(LED_2);
            break;
            
        default:
            break;
    }
}

static void system_usb_callback(usb_event_t event)
{
    switch (event)
    {
        case USB_EVENT_CONFIGURED:
            protocol_start();
            break;
            
        case USB_EVENT_DISCONNECTED:
            protocol_stop();
            break;
            
        default:
            break;
    }
}

static void system_protocol_callback(protocol_event_t event)
{
    switch (event)
    {
        case PROTOCOL_EVENT_HOST_CONNECTED:
            display_clear();
            display_draw_text("Connected to Host", 10, 10);
            break;
            
        case PROTOCOL_EVENT_HOST_DISCONNECTED:
            display_clear();
            display_draw_text("Waiting for Host...", 10, 10);
            break;
            
        case PROTOCOL_EVENT_ERROR:
            display_clear();
            display_draw_text("Protocol Error", 10, 10);
            break;
            
        default:
            break;
    }
}

// Error handler
static void error_handler(uint32_t error_code)
{
    // Disable interrupts
    __disable_irq();
    
    // Signal error with LED pattern
    while (true)
    {
        nrf_gpio_pin_toggle(LED_1);
        nrf_gpio_pin_toggle(LED_2);
        nrf_delay_ms(200);
    }
}