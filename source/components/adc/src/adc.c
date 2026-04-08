#include "adc.h"

/**
 * @brief  Initializes ADC1 on pin PA0 (Channel 0)
 */
void ADC_Init(void) {
    // Clocks (GPIOA enabled via dependencies, enable ADC1 APB2 clock)
    RCM->APB2CLKEN |= (1 << 9); // ADC1 Enable
    
    // ADC Prescaler (72MHz / 6 = 12MHz, maximum allowed is 14MHz)
    // RCM->CFG bits 14:15 -> 0x2 sets Division by 6
    RCM->CFG = (RCM->CFG & ~(0x3 << 14)) | (0x2 << 14);

    // Configure Pin PA0 as Analog Input
    // GPIOA->CFGLOW bits 0-3 (Pin 0)
    GPIOA->CFGLOW &= ~(0x0F << 0); // 0x0: Input Analog mode

    // Configure ADC
    ADC1->CTRL2 |= (1 << 0); // ADCEN = 1 (Awaits wake up)
    
    // Calibration sequence
    ADC1->CTRL2 |= (1 << 3); // Reset Calibration (CALRST)
    while (ADC1->CTRL2 & (1 << 3)); // Wait for reset to complete
    
    ADC1->CTRL2 |= (1 << 2); // Start Calibration (CAL)
    while (ADC1->CTRL2 & (1 << 2)); // Wait for calibration to complete
    
    // Set Channel 0 as the first conversion in the sequence
    ADC1->REGSEQ3 = 0; // Channel 0 at sequence position 1
}

/**
 * @brief  Reads a 12-bit analog value (for configured channels)
 */
uint16_t ADC_Read(void) {
    ADC1->CTRL2 |= (1 << 0); // Switch on ADC if sleeping
    // In APM32/STM32, the first SWSTART wakes up the ADC, the subsequent starts conversion.
    // For simplicity in polling:
    ADC1->CTRL2 |= (1 << 22); // SWSTART = 1
    
    while (!(ADC1->STS & (1 << 1))); // Wait for EOC (End of Conversion)
    
    return (uint16_t)ADC1->REGDATA;
}
