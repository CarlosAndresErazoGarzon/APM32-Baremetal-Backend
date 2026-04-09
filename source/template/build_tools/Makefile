# Makefile para APM32-bluepill-baremetal
# Target Hardware: APM32F103CBT6

# --- Toolchain ---
CC = arm-none-eabi-gcc
OBJCOPY = arm-none-eabi-objcopy
SIZE = arm-none-eabi-size

# --- Directorios ---
# Código de Usuario
SRC_DIR = src
INC_DIR = inc

# Código del Fabricante (SDK)
SDK_DIR = sdk
SDK_SRC_DIR = $(SDK_DIR)/src
SDK_INC_DIR = $(SDK_DIR)/inc
SDK_STARTUP_DIR = $(SDK_DIR)/startup


# Salida y Linker
BUILD_DIR = build
LINKER_DIR = linker

# --- Archivos ---
# Busca archivos .c
USER_SRCS = $(wildcard $(SRC_DIR)/*.c)
SDK_SRCS = $(wildcard $(SDK_SRC_DIR)/*.c)

# Definir archivo Startup (.s)
STARTUP_SRC = $(SDK_STARTUP_DIR)/startup_apm32f10x_md.s

# Definir nombres de objetos (.o)
USER_OBJS = $(patsubst $(SRC_DIR)/%.c,$(BUILD_DIR)/%.o,$(USER_SRCS))
SDK_OBJS = $(patsubst $(SDK_SRC_DIR)/%.c,$(BUILD_DIR)/%.o,$(SDK_SRCS))
STARTUP_OBJ = $(BUILD_DIR)/startup.o

# Lista total de objetos a linkear
OBJS = $(USER_OBJS) $(SDK_OBJS) $(STARTUP_OBJ)

# --- Configuración del Linker ---
LDSCRIPT = $(LINKER_DIR)/apm32_flash.ld

# --- Flags de Compilación ---
INCLUDES = -I$(INC_DIR) -I$(SDK_INC_DIR)

# Flags C: Cortex-M3, Debug, Optimización 0, Warnings
CFLAGS = -mcpu=cortex-m3 -mthumb -std=gnu11 -g -O0 -Wall \
         $(INCLUDES) -DAPM32F10X_MD

# Flags Linker: Script, sin librerías estándar, mapa de memoria
LDFLAGS = -mcpu=cortex-m3 -mthumb -T$(LDSCRIPT) \
          -Wl,--gc-sections --specs=nosys.specs -Wl,-Map=$(BUILD_DIR)/firmware.map

# --- Configuración OpenOCD ---
OPENOCD_CFG = build_tools/apm32_daplink.cfg

# --- Targets ---

all: $(BUILD_DIR)/firmware.elf $(BUILD_DIR)/firmware.bin

# Compilar C (Usuario)
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	@mkdir -p $(BUILD_DIR)
	@echo "Compilando Usuario: $<"
	@$(CC) $(CFLAGS) -c $< -o $@

# Compilar C (SDK)
$(BUILD_DIR)/%.o: $(SDK_SRC_DIR)/%.c
	@mkdir -p $(BUILD_DIR)
	@echo "Compilando SDK: $<"
	@$(CC) $(CFLAGS) -c $< -o $@

# Ensamblar Startup
$(BUILD_DIR)/startup.o: $(STARTUP_SRC)
	@mkdir -p $(BUILD_DIR)
	@echo "Ensamblando Startup..."
	@$(CC) $(CFLAGS) -c $< -o $@

# Linkear todo
$(BUILD_DIR)/firmware.elf: $(OBJS)
	@echo "Linkeando..."
	@$(CC) $(OBJS) $(LDFLAGS) -o $@
	@echo "Tamaño del Firmware:"
	@$(SIZE) $@

# Generar Binario
$(BUILD_DIR)/firmware.bin: $(BUILD_DIR)/firmware.elf
	@echo "Generando Binario..."
	@$(OBJCOPY) -O binary $< $@

clean:
	@echo "Limpiando ..."
	rm -rf $(BUILD_DIR)

flash: all
	@echo "Flasheando APM32..."
	@openocd -f $(OPENOCD_CFG) -c "program $(BUILD_DIR)/firmware.elf verify reset exit"

info:
	@echo "INFO APM32..."
	@openocd -f $(OPENOCD_CFG) -c "init; reset halt; flash probe 0; exit"

verify:
	@echo "Ejecutando Hardware Fingerprint..."
	@openocd -f $(OPENOCD_CFG) -f build_tools/verify_board.cfg

.PHONY: all clean flash info verify
