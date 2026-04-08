#ifndef __TMR_H
#define __TMR_H

#include "apm32f10x.h"

void PWM_Init(uint16_t period, uint16_t prescaler);
void PWM_SetDuty(uint16_t duty);

#endif
