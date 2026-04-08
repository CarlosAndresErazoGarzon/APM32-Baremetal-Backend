#include "uart.h"

/**
 * @brief  Configures UART1 (PA9=TX, PA10=RX) at 115200 baud (assuming 72MHz PCLK2)
 */
void UART_Init(uint32_t baudrate) {
    // Clocks (Enabled via extension dependencies: GPIOA and USART1)
    
    // Configure Pins (PA9 = AF-PP, PA10 = Floating Input)
    // GPIOA->CFGHIG (CRH in STM32) controls pins 8-15
    // PA9 is the second nibble (bits 4-7)
    GPIOA->CFGHIG &= ~(0x0F << 4); 
    GPIOA->CFGHIG |= (0x0B << 4);  // 0xB: Output 50MHz, Alternate Function Push-Pull

    // PA10 is the third nibble (bits 8-11)
    GPIOA->CFGHIG &= ~(0x0F << 8);
    GPIOA->CFGHIG |= (0x04 << 8);  // 0x4: Input Floating (Default)

    // Configure Baudrate
    // BRR = PCLK2 / BaudRate
    // If PCLK2 = 72MHz and Baud = 115200 -> BRR = 625 = 0x271
    uint32_t pclk2 = 72000000;
    USART1->BR = pclk2 / baudrate;

    // Configure Control Register (8N1, TX enable, RX enable, USART enable)
    USART1->CTRL1 = (1 << 13) | (1 << 3) | (1 << 2); // UE, TE, RE
}

void UART_Tx(char c) {
    while (!(USART1->STS & (1 << 7))); // Wait for TXE
    USART1->DATA = c;
}

// Retargeting printf to UART1
int _write(int file, char *ptr, int len) {
    for (int i = 0; i < len; i++) {
        UART_Tx(ptr[i]);
    }
    return len;
}
