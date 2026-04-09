/* Linker script for APM32F103CBT6 */
ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 128K
    RAM (xrw)  : ORIGIN = 0x20000000, LENGTH = 20K
}

_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
    /* Code in Flash */
    .text :
    {
        KEEP(*(.isr_vector))
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
        _etext = .;
    } > FLASH

    /* Initialized Data */
    /* _sidata is the address in FLASH where data sits before copying to RAM */
    _sidata = LOADADDR(.data);

    .data :
    {
        . = ALIGN(4);
        _sdata = .;        /* Start of data in RAM */
        *(.data*)
        . = ALIGN(4);
        _edata = .;        /* End of data in RAM */
    } > RAM AT > FLASH

    /* BSS Data (Zero-initialized) - Used by startup script */
    .bss :
    {
        . = ALIGN(4);
        __bss_start = .;   
        __bss_start__ = .; 
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        __bss_end = .;     
        __bss_end__ = .;   
    } > RAM
}