# GPIO Pin Modes -- The Complete CNF/MODE Reference

Every pin you've configured across Tutorials 1-3 (`0x3`, `0x8`...) is really **two 2-bit sub-fields packed into one nibble**: `CNF[1:0]` (upper 2 bits) and `MODE[1:0]` (lower 2 bits). This page is the lookup table for every valid combination -- what each one means, and what it's actually used for.

## The 4-bit Field, Bit by Bit

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

---

## Step 1: Pick a MODE

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

---

## Step 2: Pick a CNF (meaning depends on MODE)

### If MODE = Input (`00`)

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

### If MODE = Output (`01`, `10`, or `11`)

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

"General Purpose" means the CPU drives the pin directly via `ODATA`, exactly like every LED/relay in this course so far. "Alternate Function" hands the pin over to a peripheral (`USART1`, `TMR1`, `I2C1`...) -- covered in later tutorials.

---

## Step 3: Read or Write the Pin (`IDATA` / `ODATA`)

`CFGLOW`/`CFGHIG` only ever configure a pin -- they don't move any real electrical signal. Once that's done, each port has two SEPARATE one-bit-per-pin registers for actually using it, and which one applies depends entirely on the `MODE` you picked in Step 1.

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

---

## Quick Reference: Full Hex Codes

Combining both fields gives the actual value you write to `CFGLOW`/`CFGHIG`. The ones marked **used** are the ones you've already written in Tutorials 1-3:

| Hex | Binary | MODE | CNF | Meaning | Used? |
| :-: | :-: | :-- | :-- | :-- | :-: |
| `0x0` | `0000` | Input | Analog | ADC input pin | |
| `0x4` | `0100` | Input | Floating | Reset default -- every pin starts here | |
| `0x8` | `1000` | Input | Pull-up/down | Button input (ODR bit picks up vs. down) | **Tutorial 1** |
| `0x3` | `0011` | Output 50MHz | GP Push-Pull | LED / relay trigger, CPU drives both states | **Tutorials 1-3** |
| `0x7` | `0111` | Output 50MHz | GP Open-Drain | Only pulls LOW, needs an external pull-up | |
| `0xB` | `1011` | Output 50MHz | AF Push-Pull | USART TX, PWM (`TMR1_CH1`...) | |
| `0xF` | `1111` | Output 50MHz | AF Open-Drain | I2C `SCL`/`SDA` (bus is always open-drain) | |

*(Slower output speeds -- `MODE = 01`/`10` -- give the same 4 CNF combinations at `0x1`/`0x5`/`0x9`/`0xD` and `0x2`/`0x6`/`0xA`/`0xE`, but this course always uses 50MHz, so they're omitted here.)*
