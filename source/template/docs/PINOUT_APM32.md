# APM32 WeAct Pinout (BluePill Compatible)

As a baremetal developer, knowing the hardware is critical. Below is the complete pinout map for the APM32F103 board (BluePill format), detailing their primary functions, 5V tolerance, and most common alternate functions.

### Key Concepts Before Reading the Table

1. **Memory Addresses**: In the APM32 architecture, individual pins *do not have* their own dedicated memory address. Pins are grouped into Ports (`GPIOA`, `GPIOB`, etc.). Each port has a base address (e.g., `GPIOA` = `0x4001 0800`). To control a pin, you modify the corresponding bits within its port registers (`CFGLOW` for pins 0 to 7, and `CFGHIG` for pins 8 to 15).
2. **5V Tolerance (3.3V Native)**: The microcontroller runs internally at **3.3V**. If a pin says "Yes" under 5V Tolerant, it means you can safely hook up a 5V signal (like a standard Arduino sensor). If it says "**No**", the absolute maximum limit is **3.3V**; connecting 5V will physically destroy the pin.

## Pin Map - Left Side (Viewed from top, USB facing up)

| Physical Pin | Label | 5V Tolerant? | Default GPIO Usage | Main Alternate Functions |
| :---: | :---: | :---: | :--- | :--- |
| 1 | **VBAT** | - | RTC Power Supply | - |
| 2 | **PC13** | No | General Purpose (Built-in LED) | TAMPER, RTC |
| 3 | **PC14** | No | Slow (3MHz max) | OSC32_IN |
| 4 | **PC15** | No | Slow (3MHz max) | OSC32_OUT |
| 5 | **PA0** | No | Free usage | **ADC12_IN0**, TMR2_CH1, WKUP |
| 6 | **PA1** | No | Free usage | **ADC12_IN1**, TMR2_CH2 |
| 7 | **PA2** | No | Free usage | **ADC12_IN2**, TMR2_CH3, USART2_TX |
| 8 | **PA3** | No | Free usage | **ADC12_IN3**, TMR2_CH4, USART2_RX |
| 9 | **PA4** | No | Free usage | **ADC12_IN4**, SPI1_NSS |
| 10 | **PA5** | No | Free usage | **ADC12_IN5**, SPI1_SCK |
| 11 | **PA6** | No | Free usage | **ADC12_IN6**, SPI1_MISO, TMR3_CH1 |
| 12 | **PA7** | No | Free usage | **ADC12_IN7**, SPI1_MOSI, TMR3_CH2 |
| 13 | **PB0** | No | Free usage | **ADC12_IN8**, TMR3_CH3 |
| 14 | **PB1** | No | Free usage | **ADC12_IN9**, TMR3_CH4 |
| 15 | **PB10**| **Yes** | Free usage | I2C2_SCL, USART3_TX |
| 16 | **PB11**| **Yes** | Free usage | I2C2_SDA, USART3_RX |
| 17 | **RESET**| - | System Reset | - |
| 18 | **3.3V** | - | 3.3V Output | - |
| 19 | **GND** | - | Ground | - |
| 20 | **GND** | - | Ground | - |

## Pin Map - Right Side

| Physical Pin | Label | 5V Tolerant? | Default GPIO Usage | Main Alternate Functions |
| :---: | :---: | :---: | :--- | :--- |
| 40 | **5V** | - | VBUS Input/Output | - |
| 39 | **GND** | - | Ground | - |
| 38 | **3.3V** | - | 3.3V Output | - |
| 37 | **PB12**| **Yes** | Free usage | SPI2_NSS |
| 36 | **PB13**| **Yes** | Free usage | SPI2_SCK |
| 35 | **PB14**| **Yes** | Free usage | SPI2_MISO |
| 34 | **PB15**| **Yes** | Free usage | SPI2_MOSI |
| 33 | **PA8** | **Yes** | Free usage | **TMR1_CH1 (PWM)**, USART1_CK |
| 32 | **PA9** | **Yes** | Free usage | **USART1_TX**, TMR1_CH2 |
| 31 | **PA10**| **Yes** | Free usage | **USART1_RX**, TMR1_CH3 |
| 30 | **PA11**| **Yes** | Free usage | USART1_CTS, USB_D-, TMR1_CH4 |
| 29 | **PA12**| **Yes** | Free usage | USART1_RTS, USB_D+ |
| 28 | **PA15**| **Yes** | **Requires JTAG Disable** | JTDI (Debug), SPI3_NSS |
| 27 | **PB3** | **Yes** | **Requires JTAG Disable** | JTDO (Debug), SPI3_SCK |
| 26 | **PB4** | **Yes** | **Requires JTAG Disable** | JNTRST (Debug), SPI3_MISO |
| 25 | **PB5** | No | Free usage | I2C1_SMBA, SPI3_MOSI |
| 24 | **PB6** | **Yes** | Free usage | **I2C1_SCL**, TMR4_CH1 |
| 23 | **PB7** | **Yes** | Free usage | **I2C1_SDA**, TMR4_CH2 |
| 22 | **PB8** | **Yes** | Free usage | TMR4_CH3 |
| 21 | **PB9** | **Yes** | Free usage | TMR4_CH4 |

---

### Freeing Debug Pins (PA15, PB3, PB4)
By default, after any microcontroller reset, pins PA15, PB3, and PB4 are hardware-configured as JTAG interface pins. If you try to configure them as GPIO (e.g., to turn on an LED), **they will ignore your instructions**.

To use them as free pins, you must **disable the JTAG module** while preserving the SWD connection. Add this code block inside your `APM32_Init` or `main` function before configuring the GPIO:

```c
// 1. Enable Alternate Function IO (AFIO) clock
RCM->APB2CLKEN |= (1 << 0);
// 2. Modify MAPR register (PCFG1 in the APM32 library) to disable JTAG
AFIO->PCFG1 = (AFIO->PCFG1 & ~(0x7 << 24)) | (0x2 << 24); 
```

---

## GPIO Quick Reference Guide

To interact with any pin, you must follow these three basic steps in your C code (usually inside `APM32_Init` or `main`):

### 1. Enable the Port Clock
The APB2 bus manages the GPIO ports. Before reading or writing, you must enable its clock in the `RCM->APB2CLKEN` register.

```c
// Enable Port A (Bit 2)
RCM->APB2CLKEN |= (1 << 2);

// Enable Port B (Bit 3)
RCM->APB2CLKEN |= (1 << 3);

// Enable Port C (Bit 4)
RCM->APB2CLKEN |= (1 << 4);
```

### 2. Configure the Pin Mode
Use `CFGLOW` for pins 0 to 7, and `CFGHIG` for pins 8 to 15.

**As Output (E.g., Turn on an LED):**
```c
// Configure PA11 (High pin -> CFGHIG, bits 12 to 15) as 50MHz Push-Pull Output Mode (0x3)
GPIOA->CFGHIG &= ~(0xF << 12);  // First, clear the 4 corresponding bits
GPIOA->CFGHIG |=  (0x3 << 12);  // Then assign the new mode
```

**As Input with Pull-Up (E.g., Read a button connected to GND):**
```c
// Configure PB0 (Low pin -> CFGLOW, bits 0 to 3) as Input with internal resistor (0x8)
GPIOB->CFGLOW &= ~(0xF << 0);
GPIOB->CFGLOW |=  (0x8 << 0);

// To define the resistor as "Pull-UP", we send a 1 to the ODATA register
GPIOB->ODATA |= (1 << 0); 
```
*(Tip: If instead of a `Pull-UP` you needed a `Pull-DOWN`, you would send a `0`: `GPIOB->ODATA &= ~(1 << 0);`)*

### 3. Read or Write Pins

**Controlling Outputs using Output Data Register (`ODATA`):**
```c
GPIOA->ODATA |=  (1 << 11); // Set pin state to HIGH (1 VCC)
GPIOA->ODATA &= ~(1 << 11); // Set pin state to LOW (0 GND)
GPIOA->ODATA ^=  (1 << 11); // Toggle state (High/Low)
```

**Evaluating Inputs using Input Data Register (`IDATA`):**
```c
// We use a "Bitwise AND" (&) to isolate the specific pin's bit.
// Since we use a Pull-UP, the pin will read "0" when shorted to ground (pressed).
if (!(GPIOB->IDATA & (1 << 0))) {
    // The button is pressed!
    // ...execute code...
}
```
