# APM32 Baremetal Project Guide

Welcome to your APM32 baremetal project. This template is designed to give you total control over the microcontroller hardware by utilizing direct register access and minimizing abstraction layers.

## 1. Project Anatomy

Your project initializes in a strictly structured way to keep `main.c` clean and to let you focus on application logic.

### The Entry Point: `main.c`
This file contains the `main()` function and the infinite `while(1)` loop. 
Before hitting the `while` loop, the program invokes `APM32_Init()`.

### The System Configurator: `apm32_config.c`
This auto-generated file sets up the MCU environment based on the components you selected during project initialization. 

**What happens inside `APM32_Init()`?**
1. **`SystemInit()`**: Configures the main clocks (HSE, PLL) to run the MCU at 72 MHz.
2. **Peripheral Initializations**: Calls functions like `UART_Init(115200)` or `ADC_Init()` depending on your configuration.
3. **`USER CODE BEGIN` blocks**: These markers allow you to inject custom initialization code. Re-running the UI Wizard **will not** overwrite any code placed inside these designated blocks.

## 2. General Purpose Input/Output (GPIO)

Understanding how to control pins is the most essential skill in baremetal programming.

### Pin Memory Map
All GPIO ports are mapped as structures in memory. For instance, `GPIOA` controls pins PA0 to PA15. 
The key registers you must know are:
- `CFGLOW` (Configuration Low): Controls pins 0 to 7.
- `CFGHIG` (Configuration High): Controls pins 8 to 15.
- `ODATA` (Output Data): Used to write logic states (HIGH/LOW) to output pins.
- `IDATA` (Input Data): Used to read logic states from input pins.

### Valid Configuration Modes
Each pin requires 4 bits of configuration (2 for `MODE` and 2 for `CFG`). Commonly used hex values to assign:

| Mode Description | Typical Hex Value | Use Case |
| :--- | :---: | :--- |
| **Input Floating** | `0x4` | Reading default digital signals (UART RX, raw buttons). |
| **Input Pull-Up/Down** | `0x8` | Buttons or switches. Requires setting ODATA to define if it's Pull-Up (1) or Pull-Down (0). |
| **Analog Input** | `0x0` | ADC channels. Disables digital buffers completely. |
| **General Purpose Output Push-Pull** | `0x3` (50MHz) | Driving LEDs, relays, standard logic signals. |
| **Alternate Function Push-Pull** | `0xB` (50MHz) | Hardware-controlled outputs like UART TX, PWM (TMRx_CHx), SPI MOSI/SCK. |

### How to configure a new Pin manually
If you want to configure **PA4** as a general-purpose output to drive an LED:
1. **Enable the Clock**:
   ```c
   RCM->APB2CLKEN |= (1 << 2); // Enable GPIOA clock (bit 2)
   ```
2. **Configure CFGLOW (for pin 4)**:
   The bits for PA4 are 16-19.
   ```c
   GPIOA->CFGLOW &= ~(0xF << 16); // Clear previous configuration
   GPIOA->CFGLOW |=  (0x3 << 16); // 0x3: GP Output Push-Pull, 50MHz
   ```
3. **Toggle the Pin**:
   ```c
   GPIOA->ODATA ^= (1 << 4); // XOR toggles the pin state
   ```

## 3. Peripheral Quick Reference

If you injected pre-built drivers, here is how you use them:

### UART (Serial Communication)
- **Pins**: PA9 (TX), PA10 (RX)
- **Usage**: The UART driver automatically retargets the standard `printf()` function.
   ```c
   printf("Hello from APM32!\n");
   printf("Counter: %d\n", counter);
   ```

### ADC (Analog to Digital Converter)
- **Pin**: PA0 (ADC1, Channel 0)
- **Usage**: Returns a 12-bit value (0 to 4095) proportional to the voltage (0V to 3.3V).
   ```c
   uint16_t measurement = ADC_Read();
   ```

### PWM (Pulse Width Modulation)
- **Pin**: PA8 (TMR1, Channel 1)
- **Usage**: You can control the duty cycle dynamically. If you initialized `PWM_Init(1000, 500);`, then you can dynamically set a 50% duty cycle by calling:
   ```c
   PWM_SetDuty(500);
   ```

## 4. Hardware Warnings
- **Pin Conflicts**: If you manually implement a pin that is already assigned to a peripheral (like UART), communication will fail. The UI Wizard helps prevent this, but manual code overrides everything.
- **5V Tolerance**: Read the Pinout map carefully. Not all pins are 5V tolerant.

## 5. Additional Resources

We've included three fantastic documents in your project to start your journey with the APM32:

1. **[Hardware Pinout](./docs/PINOUT_APM32.md)**: A complete table with all microcontroller pins, 5V tolerance, and alternate functions.
2. **[Tutorial 1](./docs/TUTORIAL_1.md)**: A step-by-step tutorial where we connect **4 LEDs and 2 Buttons**, configuring registers manually and evaluating a truth table.
3. **[Tutorial 2](./docs/TUTORIAL_2.md)**: A tutorial where you will learn the power of whole-register configurations by controlling **2 Multiplexed 7-Segment Displays**.
