#ifndef USB_H
#define USB_H

#include <stdint.h>
#include "app_util.h"

// USB Events
typedef enum {
    USB_EVENT_CONFIGURED,
    USB_EVENT_DISCONNECTED,
    USB_EVENT_SUSPENDED,
    USB_EVENT_RESUMED,
    USB_EVENT_ERROR
} usb_event_t;

// USB Callback function type
typedef void (*usb_callback_t)(usb_event_t event);

// Initialize USB subsystem
ret_code_t usb_init(void);

// Process USB events
void usb_process(void);

// Register callback for USB events
void usb_register_callback(usb_callback_t callback);

// Send data over USB
ret_code_t usb_send_data(uint8_t *data, uint32_t length);

// Check if USB is connected and configured
bool usb_is_connected(void);

// Get last error code
uint32_t usb_get_last_error(void);

#endif // USB_H