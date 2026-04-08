#ifndef __UART_H
#define __UART_H

#include "apm32f10x.h"
#include <stdio.h>

void UART_Init(uint32_t baudrate);
void UART_Tx(char c);

#endif
