#ifndef DISPLAY_H
#define DISPLAY_H

#include <stdint.h>
#include "app_util.h"

// Display dimensions
#define DISPLAY_WIDTH  480
#define DISPLAY_HEIGHT 800

// Color format: RGB565
typedef uint16_t color_t;

// Rectangle structure for partial updates
typedef struct {
    uint16_t x;
    uint16_t y;
    uint16_t width;
    uint16_t height;
} display_rect_t;

// Display configuration
typedef struct {
    uint8_t brightness;     // 0-100%
    bool vsync_enabled;     // Enable vsync to prevent tearing
    uint8_t rotation;       // 0, 90, 180, 270 degrees
} display_config_t;

// Initialize display
ret_code_t display_init(void);

// Process display updates
void display_process(void);

// Power management
void display_suspend(void);
void display_resume(void);

// Full frame update
ret_code_t display_update_full(const color_t *buffer);

// Partial frame update
ret_code_t display_update_partial(const color_t *buffer, const display_rect_t *rect);

// Basic drawing functions
ret_code_t display_clear(void);
ret_code_t display_draw_pixel(uint16_t x, uint16_t y, color_t color);
ret_code_t display_draw_line(uint16_t x1, uint16_t y1, uint16_t x2, uint16_t y2, color_t color);
ret_code_t display_draw_rect(const display_rect_t *rect, color_t color, bool filled);
ret_code_t display_draw_text(const char *text, uint16_t x, uint16_t y);

// Configuration
ret_code_t display_set_config(const display_config_t *config);
ret_code_t display_get_config(display_config_t *config);
ret_code_t display_set_brightness(uint8_t brightness);

// Status and diagnostics
bool display_is_busy(void);
uint32_t display_get_fps(void);
uint32_t display_get_last_error(void);

#endif // DISPLAY_H