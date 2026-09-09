# GPIO Pin Modes -- The Complete CNF/MODE Reference

Every pin you've configured across Tutorials 1-3 (`0x3`, `0x8`...) is really **two 2-bit sub-fields packed into one nibble**: `CNF[1:0]` (upper 2 bits) and `MODE[1:0]` (lower 2 bits). This page is the lookup table for every valid combination -- what each one means, and what it's actually used for.

## The Big Picture: Two Registers, Two Very Different Jobs

Every pin involves **two separate concerns**, and mixing them up is the #1 source of "why doesn't my pin do anything" bugs:

|  | Register | When | What it does |
| :-- | :-- | :-- | :-- |
| **1. Configure** | `CFGLOW` / `CFGHIG` | **Once**, in `/* USER CODE BEGIN Init */` | Picks the pin's MODE + CNF (Part 1 below) |
| **2. Use** | `IDATA` / `ODATA` | **Every time**, usually inside `while(1)` | Reads/writes the pin's actual voltage (Part 2 below) |

`CFGLOW`/`CFGHIG` never move a real electrical signal by themselves -- they just decide what kind of pin this is. Writing to them over and over inside your main loop does nothing useful and wastes cycles; that's `IDATA`/`ODATA`'s job, and it's a completely different register.

---

## The `GPIOx` Struct: 4 Registers You'll Actually Use

Every port (`GPIOA`, `GPIOB`, `GPIOC`...) is really one C struct -- `apm32f10x.h` defines it, and `GPIOx->CFGLOW`/`GPIOx->ODATA`/etc. is just normal struct member access, the same as any `struct` you'd write yourself. The real peripheral has a few more registers (`BSC`, `BC`, `LOCK`...), but this course only ever touches these 4:

| Register | Full name | What it does |
| :-- | :-- | :-- |
| `CFGLOW` | Configuration Low | Sets MODE+CNF for pins **0-7** -- 4 bits per pin (Part 1) |
| `CFGHIG` | Configuration High | Sets MODE+CNF for pins **8-15** -- 4 bits per pin (Part 1) |
| `IDATA` | Input Data | **Reads** the current voltage on every pin in the port (Part 2) |
| `ODATA` | Output Data | **Sets** the voltage an output pin drives -- or the pull-up/down direction on an input pin (Part 2) |

```c
GPIOB->CFGHIG |= (0x3 << 8);    // Configure PB10 as an output (Part 1)
GPIOB->ODATA  |= (1 << 10);     // Drive PB10 HIGH (Part 2)
if (GPIOB->IDATA & (1 << 11)) { // Read PB11's current state (Part 2)
    // ...
}
```

Same struct, same `->` syntax, four different jobs -- which one you need depends entirely on whether you're in Part 1 (configuring, once) or Part 2 (using, every loop) below.

---

## Part 1: Configure -- the 4-bit Field, Bit by Bit

Whichever register you're writing to (`CFGLOW` for pins 0-7, `CFGHIG` for pins 8-15), every pin gets exactly this shape. Reading a nibble left to right is always `CNF1, CNF0, MODE1, MODE0`:

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 340 130" width="100%" style="max-width: 340px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="A generic 4-bit GPIO configuration nibble: bit3=CNF1, bit2=CNF0, bit1=MODE1, bit0=MODE0">
  <g font-size="11" fill="var(--sidebar-text)" text-anchor="middle">
    <text x="42" y="20">bit 3</text><text x="126" y="20">bit 2</text><text x="210" y="20">bit 1</text><text x="294" y="20">bit 0</text>
  </g>
  <g stroke="var(--border-color)" stroke-width="1.5">
    <rect x="8"   y="28" width="68" height="44" fill="none"/>
    <rect x="92"  y="28" width="68" height="44" fill="none"/>
    <rect x="176" y="28" width="68" height="44" fill="var(--sidebar-bg)"/>
    <rect x="260" y="28" width="68" height="44" fill="var(--sidebar-bg)"/>
  </g>
  <g font-size="13" font-weight="700" fill="var(--text-main)" text-anchor="middle">
    <text x="42" y="55">CNF1</text><text x="126" y="55">CNF0</text><text x="210" y="55">MODE1</text><text x="294" y="55">MODE0</text>
  </g>
  <g font-size="10" fill="var(--text-muted)" text-anchor="middle">
    <text x="84" y="98">CNF[1:0]</text><text x="252" y="98">MODE[1:0]</text>
  </g>
  <g stroke="var(--text-muted)" stroke-width="1">
    <path d="M 8 90 L 160 90"/><path d="M 176 90 L 328 90"/>
  </g>
  <text x="84" y="116" text-anchor="middle" font-size="10" fill="var(--text-muted)">meaning depends on MODE</text>
  <text x="252" y="116" text-anchor="middle" font-size="10" fill="var(--text-muted)">picks speed / direction</text>
</svg>
</div>

Both halves get written together as ONE hex value (`0x3`, `0x8`...) -- they're not two separate instructions, just two questions you answer before combining them into a single nibble:

### Question A: What `MODE`?

`MODE[1:0]` always means the same thing, no matter what `CNF` ends up being:

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 640 130" width="100%" style="max-width: 640px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="MODE bits: 00 Input, 01 Output 10MHz, 10 Output 2MHz, 11 Output 50MHz (highlighted, used throughout this course)">
  <g stroke="var(--border-color)" stroke-width="1.5">
    <rect x="16"  y="20" width="64" height="44" fill="none"/><rect x="80"  y="20" width="64" height="44" fill="none"/>
    <rect x="172" y="20" width="64" height="44" fill="none"/><rect x="236" y="20" width="64" height="44" fill="none"/>
    <rect x="328" y="20" width="64" height="44" fill="none"/><rect x="392" y="20" width="64" height="44" fill="none"/>
  </g>
  <g stroke="var(--accent-text)" stroke-width="2">
    <rect x="484" y="20" width="64" height="44" fill="none"/><rect x="548" y="20" width="64" height="44" fill="none"/>
  </g>
  <g font-size="16" font-weight="700" fill="var(--text-main)" text-anchor="middle">
    <text x="48"  y="49">0</text><text x="112" y="49">0</text>
    <text x="204" y="49">0</text><text x="268" y="49">1</text>
    <text x="360" y="49">1</text><text x="424" y="49">0</text>
    <text x="516" y="49">1</text><text x="580" y="49">1</text>
  </g>
  <g font-size="12" fill="var(--text-main)" text-anchor="middle">
    <text x="80"  y="86">Input</text>
    <text x="204" y="86">Output</text><text x="204" y="100" font-size="10" fill="var(--text-muted)">10MHz max</text>
    <text x="360" y="86">Output</text><text x="360" y="100" font-size="10" fill="var(--text-muted)">2MHz max</text>
    <text x="516" y="86" font-weight="700" fill="var(--accent-text)">Output</text><text x="516" y="100" font-size="10" fill="var(--accent-text)">50MHz max -- used here</text>
  </g>
</svg>
</div>

All three tutorials so far use `MODE = 11` (50MHz) for every output pin -- there's no downside to the fastest slew rate on a breadboard demo, it only matters for real EMI-sensitive designs.

### Question B: What `CNF`? (its meaning depends on your answer to A)

**If `MODE` = Input (`00`):**

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 500 130" width="100%" style="max-width: 500px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="Input CNF bits: 00 Analog, 01 Floating (reset default), 10 Pull-up/Pull-down (highlighted, used in Tutorial 1)">
  <g stroke="var(--border-color)" stroke-width="1.5">
    <rect x="16"  y="20" width="64" height="44" fill="none"/><rect x="80"  y="20" width="64" height="44" fill="none"/>
    <rect x="172" y="20" width="64" height="44" fill="none"/><rect x="236" y="20" width="64" height="44" fill="none"/>
  </g>
  <g stroke="var(--accent-text)" stroke-width="2">
    <rect x="328" y="20" width="64" height="44" fill="none"/><rect x="392" y="20" width="64" height="44" fill="none"/>
  </g>
  <g font-size="16" font-weight="700" fill="var(--text-main)" text-anchor="middle">
    <text x="48"  y="49">0</text><text x="112" y="49">0</text>
    <text x="204" y="49">0</text><text x="268" y="49">1</text>
    <text x="360" y="49">1</text><text x="424" y="49">0</text>
  </g>
  <g font-size="12" fill="var(--text-main)" text-anchor="middle">
    <text x="80"  y="86">Analog</text><text x="80" y="100" font-size="10" fill="var(--text-muted)">(ADC input)</text>
    <text x="204" y="86">Floating</text><text x="204" y="100" font-size="10" fill="var(--text-muted)">reset default</text>
    <text x="360" y="86" font-weight="700" fill="var(--accent-text)">Pull-up/down</text><text x="360" y="100" font-size="10" fill="var(--accent-text)">used in Tutorial 1</text>
  </g>
</svg>
</div>

`11` (reserved) is not a valid input CNF -- the hardware doesn't define a fourth input mode.

**If `MODE` = Output (`01`, `10`, or `11`):**

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 640 130" width="100%" style="max-width: 640px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="Output CNF bits: 00 General Purpose Push-Pull (highlighted, used in Tutorials 1-3), 01 General Purpose Open-Drain, 10 Alternate Function Push-Pull, 11 Alternate Function Open-Drain">
  <g stroke="var(--accent-text)" stroke-width="2">
    <rect x="16"  y="20" width="64" height="44" fill="none"/><rect x="80"  y="20" width="64" height="44" fill="none"/>
  </g>
  <g stroke="var(--border-color)" stroke-width="1.5">
    <rect x="172" y="20" width="64" height="44" fill="none"/><rect x="236" y="20" width="64" height="44" fill="none"/>
    <rect x="328" y="20" width="64" height="44" fill="none"/><rect x="392" y="20" width="64" height="44" fill="none"/>
    <rect x="484" y="20" width="64" height="44" fill="none"/><rect x="548" y="20" width="64" height="44" fill="none"/>
  </g>
  <g font-size="16" font-weight="700" fill="var(--text-main)" text-anchor="middle">
    <text x="48"  y="49">0</text><text x="112" y="49">0</text>
    <text x="204" y="49">0</text><text x="268" y="49">1</text>
    <text x="360" y="49">1</text><text x="424" y="49">0</text>
    <text x="516" y="49">1</text><text x="580" y="49">1</text>
  </g>
  <g font-size="12" fill="var(--text-main)" text-anchor="middle">
    <text x="48"  y="86" font-weight="700" fill="var(--accent-text)">GP Push-Pull</text><text x="48" y="100" font-size="10" fill="var(--accent-text)">used in Tutorials 1-3</text>
    <text x="204" y="86">GP Open-Drain</text><text x="204" y="100" font-size="10" fill="var(--text-muted)">needs external pull-up</text>
    <text x="360" y="86">AF Push-Pull</text><text x="360" y="100" font-size="10" fill="var(--text-muted)">USART TX, PWM...</text>
    <text x="516" y="86">AF Open-Drain</text><text x="516" y="100" font-size="10" fill="var(--text-muted)">I2C SCL/SDA...</text>
  </g>
</svg>
</div>

"General Purpose" means the CPU drives the pin directly via `ODATA`, exactly like every LED/relay in this course so far. "Alternate Function" instead hands the pin over to a peripheral (`USART1`, `TMR1`, `I2C1`...), which drives it directly -- not used in Tutorials 1-3, but listed here since the CNF bits already support it.

**Combine both answers into one nibble** and that's the hex value you actually write -- see the Quick Reference table at the bottom of this page for the full list.

### Worked Examples

**`PC13` as a Push-Pull Output** (this board's built-in LED). Pin 13 is in the port's *high* half, so it's `CFGHIG`, at bit offset `(13-8) * 4 = 20`. `MODE=11` + `CNF=00` = `0x3`:

```c
RCM->APB2CLKEN |= (1 << 4);      // Enable Port C's clock
GPIOC->CFGHIG  &= ~(0xF << 20);  // Clear PC13's nibble first
GPIOC->CFGHIG  |=  (0x3 << 20);  // MODE=11, CNF=00 -> Output, Push-Pull, 50MHz
```

**`PA0` as a Pull-up Input**. Pin 0 is in the port's *low* half, so it's `CFGLOW`, at bit offset `0 * 4 = 0`. `MODE=00` + `CNF=10` = `0x8`:

```c
RCM->APB2CLKEN |= (1 << 2);      // Enable Port A's clock
GPIOA->CFGLOW  &= ~(0xF << 0);   // Clear PA0's nibble first
GPIOA->CFGLOW  |=  (0x8 << 0);   // MODE=00, CNF=10 -> Input, Pull-up/down
GPIOA->ODATA   |=  (1 << 0);     // ...pick UP, not down (why: see Part 2)
```

Both pins come back in Part 2's own worked examples below, using exactly what was just configured here.

---

## Part 2: Use -- Read or Write with `IDATA` / `ODATA`

Configuration is done, one time, in `Init`. Everything below happens instead, every time you actually want to DO something with the pin -- usually inside `while(1)`. Which register applies still depends on the `MODE` you picked above.

### Output pins -- write `ODATA`

Once a pin is `MODE = 01`/`10`/`11` (any Output), `ODATA` is what the CPU drives it with:

```c
GPIOB->ODATA |=  (1 << 11); // Set HIGH (3.3V)
GPIOB->ODATA &= ~(1 << 11); // Set LOW (0V)
GPIOB->ODATA ^=  (1 << 11); // Toggle
```

This is exactly what every LED (Tutorial 1), 7-segment digit (Tutorial 2), and relay (Tutorial 3) in this course already does -- the classic blink example's `GPIOB->ODATA ^= (1 << 2);` is the SAME instruction as the line above, just with `^=` for toggling instead of a fixed HIGH/LOW.

### Input pins -- read `IDATA`

Once a pin is `MODE = 00` (Input, any `CNF`), `IDATA` is where the CPU reads its current voltage:

```c
if (GPIOB->IDATA & (1 << 10)) {
    // Pin is currently HIGH
}
```

Tutorial 1's buttons use the inverted form of this -- `!(GPIOB->IDATA & (1 << 10))` -- because they're wired with the internal pull-up active (see the note below), so "pressed" reads as a `0`, not a `1`.

> [!NOTE]
> **`ODATA` has a second job on Input Pull-up/Pull-down pins (`CNF = 10`).**
> On an Input pin there's no output to drive, so `ODATA` stops meaning "set the voltage" and instead **picks which internal resistor gets enabled**:
> ```c
> GPIOB->ODATA |=  (1 << 10); // Pull-UP
> GPIOB->ODATA &= ~(1 << 10); // Pull-DOWN
> ```
> `IDATA` still just reads the real pin voltage either way -- this is the SAME register as the output case above doing something completely different, because the pin's `MODE`/`CNF` changes what that bit is even wired to internally. This is exactly what Tutorial 1's button setup (and `PINOUT_APM32.md`'s own GPIO Quick Reference) already does.

### Worked Examples

Continuing the exact same two pins configured in Part 1's worked examples -- this is the "every loop" half of each one:

**Using `PC13`** (configured as a Push-Pull Output above) -- blink it inside `while(1)`:

```c
GPIOC->ODATA ^= (1 << 13); // Toggle
delay_ms(500);
```

**Using `PA0`** (configured as a Pull-up Input above) -- check if it's pressed:

```c
if (!(GPIOA->IDATA & (1 << 0))) {
    // Pressed -- pull-up means "pressed" reads back as a 0, not a 1
}
```

Notice neither of these touches `CFGLOW`/`CFGHIG` at all -- that part is already done, sitting untouched from Part 1, for as long as the program runs.

---

## Quick Reference: Full Hex Codes

Combining both fields (Part 1) gives the actual value you write to `CFGLOW`/`CFGHIG`. The ones marked **used** are the ones you've already written in Tutorials 1-3:

| Hex | Binary | MODE | CNF | Meaning | Used? |
| :-: | :-: | :-- | :-- | :-- | :-: |
| `0x0` | `0000` | Input | Analog | ADC input pin | |
| `0x4` | `0100` | Input | Floating | Reset default -- every pin starts here | |
| `0x8` | `1000` | Input | Pull-up/down | Button input (`ODATA` bit picks up vs. down) | **Tutorial 1** |
| `0x3` | `0011` | Output 50MHz | GP Push-Pull | LED / relay trigger, CPU drives both states | **Tutorials 1-3** |
| `0x7` | `0111` | Output 50MHz | GP Open-Drain | Only pulls LOW, needs an external pull-up | |
| `0xB` | `1011` | Output 50MHz | AF Push-Pull | USART TX, PWM (`TMR1_CH1`...) | |
| `0xF` | `1111` | Output 50MHz | AF Open-Drain | I2C `SCL`/`SDA` (bus is always open-drain) | |

*(Slower output speeds -- `MODE = 01`/`10` -- give the same 4 CNF combinations at `0x1`/`0x5`/`0x9`/`0xD` and `0x2`/`0x6`/`0xA`/`0xE`, but this course always uses 50MHz, so they're omitted here.)*
