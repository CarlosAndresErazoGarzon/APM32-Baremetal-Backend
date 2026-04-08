#ifndef DELAY_H
#define DELAY_H

#include <stdint.h>

extern volatile uint32_t msTicks;

// Prototipos
void SysTick_Init(void);
void delay_ms(uint32_t ms);

#endif