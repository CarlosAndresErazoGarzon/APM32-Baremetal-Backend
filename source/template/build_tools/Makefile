# Makefile for APM32-bluepill-baremetal
# Target Hardware: APM32F103CBT6

# --- Toolchain ---
CC = arm-none-eabi-gcc
OBJCOPY = arm-none-eabi-objcopy
SIZE = arm-none-eabi-size

# --- Directories ---
# User Code
SRC_DIR = src
INC_DIR = inc

# Manufacturer SDK
SDK_DIR = sdk
SDK_SRC_DIR = $(SDK_DIR)/src
SDK_INC_DIR = $(SDK_DIR)/inc
SDK_STARTUP_DIR = $(SDK_DIR)/startup

# Build and Linker
BUILD_DIR = build
LINKER_DIR = linker

# --- Files ---
# Find all .c source files
USER_SRCS = $(wildcard $(SRC_DIR)/*.c)
SDK_SRCS = $(wildcard $(SDK_SRC_DIR)/*.c)

# Startup Assembly File
STARTUP_SRC = $(SDK_STARTUP_DIR)/startup_apm32f10x_md.s

# Define Object Names (.o)
USER_OBJS = $(patsubst $(SRC_DIR)/%.c,$(BUILD_DIR)/%.o,$(USER_SRCS))
SDK_OBJS = $(patsubst $(SDK_SRC_DIR)/%.c,$(BUILD_DIR)/%.o,$(SDK_SRCS))
STARTUP_OBJ = $(BUILD_DIR)/startup.o

# Total list of objects to link
OBJS = $(USER_OBJS) $(SDK_OBJS) $(STARTUP_OBJ)

# --- Linker Configuration ---
LDSCRIPT = $(LINKER_DIR)/apm32_flash.ld

# --- Compilation Flags ---
INCLUDES = -I$(INC_DIR) -I$(SDK_INC_DIR)

# C Flags: Cortex-M3, Debug, Optimization 0, Warnings
CFLAGS = -mcpu=cortex-m3 -mthumb -std=gnu11 -g -O0 -Wall \
         $(INCLUDES) -DAPM32F10X_MD

# Linker Flags: Custom script, no standard libs, map file generation
LDFLAGS = -mcpu=cortex-m3 -mthumb -T$(LDSCRIPT) \
          -Wl,--gc-sections --specs=nosys.specs -Wl,-Map=$(BUILD_DIR)/firmware.map

# --- OpenOCD Configuration ---
OPENOCD_CFG = build_tools/apm32_daplink.cfg

# --- Targets ---

all: $(BUILD_DIR)/firmware.elf $(BUILD_DIR)/firmware.bin

# Compile User C Files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	@mkdir -p $(BUILD_DIR)
	@echo "Compiling User: $<"
	@$(CC) $(CFLAGS) -c $< -o $@

# Compile SDK C Files
$(BUILD_DIR)/%.o: $(SDK_SRC_DIR)/%.c
	@mkdir -p $(BUILD_DIR)
	@echo "Compiling SDK: $<"
	@$(CC) $(CFLAGS) -c $< -o $@

# Assemble Startup Code
$(BUILD_DIR)/startup.o: $(STARTUP_SRC)
	@mkdir -p $(BUILD_DIR)
	@echo "Assembling Startup..."
	@$(CC) $(CFLAGS) -c $< -o $@

# Final Linkage
$(BUILD_DIR)/firmware.elf: $(OBJS)
	@echo "Linking..."
	@$(CC) $(OBJS) $(LDFLAGS) -o $@
	@echo "Firmware Size Statistics:"
	@$(SIZE) $@

# Generate Binary File
$(BUILD_DIR)/firmware.bin: $(BUILD_DIR)/firmware.elf
	@echo "Generating Binary Output..."
	@$(OBJCOPY) -O binary $< $@

clean:
	@echo "Cleaning build directory..."
	rm -rf $(BUILD_DIR)

flash: all
	@echo "Flashing APM32 Device..."
	@openocd -f $(OPENOCD_CFG) -c "program $(BUILD_DIR)/firmware.elf verify reset exit"

info:
	@echo "Reading APM32 Device Information..."
	@openocd -f $(OPENOCD_CFG) -c "init; reset halt; flash probe 0; exit"

verify:
	@echo "Executing Hardware Fingerprint..."
	@openocd -f $(OPENOCD_CFG) -f build_tools/verify_board.cfg

.PHONY: all clean flash info verify
