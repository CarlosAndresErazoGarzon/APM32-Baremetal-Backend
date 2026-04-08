#include "delay.h"
#include "apm32f10x.h"

volatile uint32_t msTicks = 0;

void SysTick_Init(void) {
    // Update SystemCoreClock variable in case HSE fails and HSI (8MHz) is used
    SystemCoreClockUpdate();
    
    // Configure SysTick for 1ms intervals
    if (SysTick_Config(SystemCoreClock / 1000)) {
        while (1); // Error trap
    }
    
    // Set SysTick to the highest priority (0) to prevent delay_ms() from deadlocking
    NVIC_SetPriority(SysTick_IRQn, 0);
}

void delay_ms(uint32_t ms) {
    uint32_t start = msTicks;
    while ((msTicks - start) < ms);
}

void SysTick_Handler(void) {
    msTicks++;
}