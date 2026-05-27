#ifndef DELAY_H
#define DELAY_H

#include <stdint.h>

extern volatile uint32_t msTicks;

// Prototipos
void SysTick_Init(void);
void delay_ms(uint32_t ms);

// Aliases for common naming conventions
#define DelayMs     delay_ms
#define Delay_ms    delay_ms
#define delayMs     delay_ms
#define DELAY_MS    delay_ms

#endif