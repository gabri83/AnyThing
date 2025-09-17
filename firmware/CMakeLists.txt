cmake_minimum_required(VERSION 3.20)

# Set project name and version
project(anything_firmware
    VERSION 0.1.0
    DESCRIPTION "AnyThing Firmware for CarThing"
    LANGUAGES C ASM)

# Include Nordic SDK
set(NRF_SDK_PATH ${CMAKE_SOURCE_DIR}/lib/nrf_sdk CACHE PATH "Path to Nordic SDK")
if(NOT EXISTS ${NRF_SDK_PATH})
    message(FATAL_ERROR "Nordic SDK not found at ${NRF_SDK_PATH}")
endif()

# Target specific settings
set(MCU_FAMILY nrf52)
set(MCU_MODEL nrf52840)
set(LINKER_SCRIPT ${CMAKE_SOURCE_DIR}/lib/nrf52840_xxaa.ld)

# Compiler settings
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
add_compile_options(
    -mcpu=cortex-m4
    -mthumb
    -mabi=aapcs
    -mfloat-abi=hard
    -mfpu=fpv4-sp-d16
    -ffunction-sections
    -fdata-sections
    -fno-strict-aliasing
    -fno-builtin
    -fshort-enums
    -Wall
    -Wextra
    -Werror
    $<$<CONFIG:Debug>:-g3>
    $<$<CONFIG:Release>:-O3>
)

# Linker settings
add_link_options(
    -mcpu=cortex-m4
    -mthumb
    -mabi=aapcs
    -mfloat-abi=hard
    -mfpu=fpv4-sp-d16
    -Wl,--gc-sections
    -Wl,--print-memory-usage
    --specs=nano.specs
    -T${LINKER_SCRIPT}
)

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/include
    ${NRF_SDK_PATH}/components/libraries/util
    ${NRF_SDK_PATH}/components/libraries/usbd
    ${NRF_SDK_PATH}/components/libraries/delay
    ${NRF_SDK_PATH}/integration/nrfx/legacy
    ${NRF_SDK_PATH}/components/drivers_nrf/nrf_soc_nosd
    ${NRF_SDK_PATH}/components/toolchain/cmsis/include
    ${NRF_SDK_PATH}/modules/nrfx
    ${NRF_SDK_PATH}/modules/nrfx/mdk
    ${NRF_SDK_PATH}/modules/nrfx/hal
    ${NRF_SDK_PATH}/modules/nrfx/drivers/include
)

# Source files
file(GLOB_RECURSE SOURCES 
    "src/*.c"
    "src/usb/*.c"
    "src/display/*.c"
    "src/input/*.c"
    "src/power/*.c"
    "src/protocol/*.c"
)

# Create firmware target
add_executable(${PROJECT_NAME} ${SOURCES})
target_link_libraries(${PROJECT_NAME}
    ${NRF_SDK_PATH}/components/toolchain/gcc/gcc_startup_nrf52840.S
)

# Create hex file
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O ihex
    ${CMAKE_BINARY_DIR}/${PROJECT_NAME}
    ${CMAKE_BINARY_DIR}/${PROJECT_NAME}.hex
)

# Add testing
enable_testing()
add_subdirectory(test)

# Add packaging
set(CPACK_GENERATOR "ZIP")
set(CPACK_PACKAGE_VERSION_MAJOR ${PROJECT_VERSION_MAJOR})
set(CPACK_PACKAGE_VERSION_MINOR ${PROJECT_VERSION_MINOR})
set(CPACK_PACKAGE_VERSION_PATCH ${PROJECT_VERSION_PATCH})
include(CPack)