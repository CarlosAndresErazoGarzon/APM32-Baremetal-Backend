#include "tmr.h"

/**
 * @brief  Configures TMR1_CH1 (PA8) for PWM output
 * @param  period: Auto-Reload Register (ARR) value
 * @param  prescaler: Frequency divider (PSC) value
 */
void PWM_Init(uint16_t period, uint16_t prescaler) {
    // Clocks (Inherited via dependencies: GPIOA and TMR1)
    RCM->APB2CLKEN |= (1 << 11); // TMR1 Enable
    
    // Configure PA8 as AF-PP (Alternate Function Push-Pull)
    GPIOA->CFGHIG &= ~(0x0F << 0);
    GPIOA->CFGHIG |= (0x0B << 0); // Alternate Function Push-Pull, 50MHz

    // Configure Time Base
    TMR1->PSC = prescaler - 1;
    TMR1->AUTORLD = period - 1;

    // Configure Channel 1 (PWM Mode 1)
    // CCMOD1: bits 4-6 are OC1M (Output Compare 1 Mode)
    // 0x6: PWM mode 1
    TMR1->CCM1 &= ~(0x7 << 4);
    TMR1->CCM1 |= (0x6 << 4);
    TMR1->CCM1 |= (1 << 3); // Output Compare 1 Preload Enable

    // Enable Output
    TMR1->CCEN |= (1 << 0); // CC1E: Capture/Compare 1 Output Enable
    TMR1->BDT_B.MOEN = 1;   // Main Output Enable

    // Start Timer
    TMR1->CTRL1 |= (1 << 7); // ARPE: Auto-reload preload enable
    TMR1->CTRL1 |= (1 << 0); // CEN: Counter Enable
}

/**
 * @brief  Updates the PWM duty cycle
 * @param  duty: Compare value (0 to configured period)
 */
void PWM_SetDuty(uint16_t duty) {
    TMR1->CC1 = duty;
}
