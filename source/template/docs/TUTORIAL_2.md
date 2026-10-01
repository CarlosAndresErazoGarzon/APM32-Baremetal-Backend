# Tutorial 2: Multiplexing Two 7-Segment Displays

**Objective:** Command whole-register manipulations and master **time multiplexing** by controlling two 7-Segment Displays simultaneously using Persistence of Vision (PoV).

**Based on the Fritzing Diagram:**
![7 Segment Setup](./img/2_7_Segment_bb.png)

This setup is a **Multiplexed Common Anode** system. 
*   **Data Bus (Segments):** Pins `PA0` to `PA7`. Being Common Anode, individual segments turn ON when we apply a logic `0` (GND) to them.
*   **Digit Selectors (PNP Transistors):** Pins `PB8` and `PB9`. Being PNP transistors, they act as switches throwing VCC into the Common Anode when a logic `0` is applied to their bases.

> [!NOTE]
> **Hardware Variation: LDS-5261DS (Dual Output Module)**
> If you are using the compact 10-pin **LDS-5261DS** dual 7-segment display (or similar):
> * **It is Common Cathode.** It shares the ground (`-`), not the VCC.
> * **Wiring:** The common digit selection pins on this display are **Pin 8 (Digit 1)** and **Pin 7 (Digit 2)**. You can connect `PB8` and `PB9` directly to these display pins (omitting the PNP transistors) to act as current sinks.
> * **Code Adaptation:** Because it is Common Cathode, segments turn ON with a logic `1`. You must remove the bitwise negate operator (`~`) when loading data into Port A in your `while(1)` loop. (e.g., use `(nums[5] & 0xFF)` directly instead of `(~nums[5] & 0xFF)`). Writing `0` to the Common pins (`PB8` / `PB9`) will still successfully activate that digit by pulling the current to Ground!

---

## 1. Find YOUR Board's Segment Wiring First

> [!WARNING]
> **Which physical pin drives which segment (A-G) is NOT guaranteed to be the same on every display unit** -- it depends on the internal PCB routing of the specific module you were handed, which varies between suppliers/batches even for visually identical parts. A real reported bug: a previous version of this page assumed a fixed, scrambled bit order that turned out to be wrong for the boards actually in the lab, and produced garbled digits with code that was otherwise 100% correct. **Don't copy the table in Section 2 blindly -- verify your own wiring first**, with either method below.

### Method A: One segment at a time (recommended -- uses only what you already have)

Configure `PA0`-`PA7` as outputs (Section 3 below shows how), then in `while(1)` drive **exactly one bit HIGH at a time**, with a long delay so you can actually see it:

```c
for (uint8_t bit = 0; bit < 8; bit++) {
    GPIOA->ODATA = ~(1 << bit); // Common Anode: 0 = ON, so every OTHER segment
                                 // must be 1 (off) -- only `bit` goes to 0.
    delay_ms(1500);
}
```

Watch the display and write down, for each `bit` (0 through 7), which segment lit up (A, B, C, D, E, F, G, or the decimal point DP). That mapping -- not the one in this doc -- is the one you use for your own `nums[]` array.

### Method B: Multimeter, no code needed

With the board unpowered, set your multimeter to **diode/continuity mode** and probe the Common pin (anode or cathode, whichever your module is) against each of the 8 data pins in turn. On a Common Anode display, the segment LED whose pin you're touching will light up faintly -- again, note which segment lights for which pin.

---

## 2. The Display Alphabet

Once you know YOUR board's mapping, build the lookup table around it. This tutorial's own board measured out to the simplest possible case -- **segment A on `PA0`, B on `PA1`, C on `PA2`, D on `PA3`, E on `PA4`, F on `PA5`, G on `PA6`** (bit `N` of the byte you send to `GPIOA->ODATA` is segment `N`, in alphabetical order) -- so that's the example used here. If Method A/B above gave you a different order, re-derive each value the same way: set the bit for every segment that should be ON, leave the rest 0, matching YOUR bit-to-segment assignment instead of this one.

In positive logic, a '0' (`0b00111111` = `0x3F`) lights up segments A, B, C, D, E, F. We will bitwise negate (`~`) this pattern in the code when sending it to the port to fit our inverted (Common Anode) connection.

Declare this before the `main` function in your `main.c`:

```c
/* USER CODE BEGIN Private Functions */

// Bit structure (THIS board): 0b0gfedcba, straight alphabetical --
// bit0=A, bit1=B, bit2=C, bit3=D, bit4=E, bit5=F, bit6=G. Verify this
// matches YOUR board with Method A/B above before trusting these values.
const uint8_t nums[10] = {
    0x3F, // 0
    0x06, // 1
    0x5B, // 2
    0x4F, // 3
    0x66, // 4
    0x6D, // 5
    0x7D, // 6
    0x07, // 7
    0x7F, // 8
    0x6F  // 9
};

/* USER CODE END Private Functions */
```

---

## 3. Super Fast Configuration

Since we are strictly using the 8 lowest pins of Port A, we can configure all of them at once with a single instruction (rather than bit-by-bit masking). Then, we will configure `PB8` and `PB9` individually.

Notice below that `PA0` (in `CFGLOW`) and `PB8` (in `CFGHIG`) both get the exact same `0x3` -- **different registers, same 4-bit-per-pin format**. `CFGLOW` always covers a port's pins 0-7, `CFGHIG` always covers pins 8-15, but bit position within each nibble means the same thing in both:

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 648 190" width="100%" style="max-width: 648px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="PA0 in CFGLOW bits 3-0 and PB8 in CFGHIG bits 3-0, both set to 0x3: Output Push-Pull 50MHz">
  <!-- PA0 nibble (CFGLOW, bits 3-0) -->
  <text x="168" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent-text)">PA0 -- CFGLOW bits 3..0</text>
  <path d="M 24 22 L 24 30 L 312 30 L 312 22" fill="none" stroke="var(--accent-text)" stroke-width="1.5"/>
  <!-- PB8 nibble (CFGHIG, bits 3-0) -->
  <text x="480" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="var(--success-text)">PB8 -- CFGHIG bits 3..0</text>
  <path d="M 336 22 L 336 30 L 624 30 L 624 22" fill="none" stroke="var(--success-text)" stroke-width="1.5"/>
  <!-- Bit index labels -->
  <g font-size="11" fill="var(--sidebar-text)" text-anchor="middle">
    <text x="60" y="46">3</text><text x="132" y="46">2</text><text x="204" y="46">1</text><text x="276" y="46">0</text>
    <text x="372" y="46">3</text><text x="444" y="46">2</text><text x="516" y="46">1</text><text x="588" y="46">0</text>
  </g>
  <!-- Value boxes: both 0x3 = 0011 (read as CNF1,CNF0,MODE1,MODE0) -->
  <g stroke="var(--border-color)" stroke-width="1.5">
    <rect x="24"  y="54" width="72" height="44" fill="none"/>
    <rect x="96"  y="54" width="72" height="44" fill="none"/>
    <rect x="168" y="54" width="72" height="44" fill="var(--sidebar-bg)"/>
    <rect x="240" y="54" width="72" height="44" fill="var(--sidebar-bg)"/>
    <rect x="336" y="54" width="72" height="44" fill="none"/>
    <rect x="408" y="54" width="72" height="44" fill="none"/>
    <rect x="480" y="54" width="72" height="44" fill="var(--sidebar-bg)"/>
    <rect x="552" y="54" width="72" height="44" fill="var(--sidebar-bg)"/>
  </g>
  <g font-size="16" font-weight="700" fill="var(--text-main)" text-anchor="middle">
    <text x="60" y="83">0</text><text x="132" y="83">0</text><text x="204" y="83">1</text><text x="276" y="83">1</text>
    <text x="372" y="83">0</text><text x="444" y="83">0</text><text x="516" y="83">1</text><text x="588" y="83">1</text>
  </g>
  <!-- CNF/MODE sub-labels under each bit -->
  <g font-size="9" fill="var(--text-muted)" text-anchor="middle">
    <text x="60" y="112">CNF1</text><text x="132" y="112">CNF0</text><text x="204" y="112">MODE1</text><text x="276" y="112">MODE0</text>
    <text x="372" y="112">CNF1</text><text x="444" y="112">CNF0</text><text x="516" y="112">MODE1</text><text x="588" y="112">MODE0</text>
  </g>
  <!-- Legend -->
  <g font-size="12" fill="var(--text-main)">
    <text x="24" y="145">0x3 = 0b0011 -&gt; MODE[1:0]=11 (Output, 50MHz), CNF[1:0]=00 (Push-Pull)</text>
    <text x="24" y="164" fill="var(--text-muted)">Identical bit pattern in both registers -- only WHICH register (and which nibble inside it) changes which physical pin it controls.</text>
    <text x="24" y="182" fill="var(--text-muted)">Check the PIN MODES tab for every other CNF/MODE combination.</text>
  </g>
</svg>
</div>

Add this inside `/* USER CODE BEGIN Init */`:

```c
/* USER CODE BEGIN Init */

// 1. Enable Clocks for Port A and Port B
RCM->APB2CLKEN |= (1 << 2) | (1 << 3);

// 2. Configure pins PA0 to PA7 as Push-Pull Outputs (0x3)
// A 32-bit number holds exactly 8 bundles of 4-bit configurations. 
// To turn the entire CFGLOW into outputs, we write 0x3 repeated 8 times.
GPIOA->CFGLOW = 0x33333333;

// 3. Configure digit selectors PB8 and PB9 as Push-Pull Outputs (0x3)
// PB8 and PB9 are the LOWEST pins of CFGHIG (bits 0 to 7)
GPIOB->CFGHIG &= ~(0xFF << 0);
GPIOB->CFGHIG |=  (0x33 << 0);

// 4. Turn OFF the displays (Turn off the PNP transistors by sending a 1 to their ports)
GPIOB->ODATA |= (1 << 8) | (1 << 9);

/* USER CODE END Init */
```

*(Note: In real embedded programming, knowing how to overwrite the complete `CFGLOW` with `0x33333333` saves dozens of CPU clock cycles compared to using heavy, generic HAL functions).*

---

## 4. Main Loop: Persistence of Vision

To display a number like "85", our MCU must perform:
1. Turn OFF both transistors.
2. Write the "5" data to `PORTA`.
3. Turn ON the Units transistor and wait 5ms.
4. Turn OFF both transistors.
5. Write the "8" data to `PORTA`.
6. Turn ON the Tens transistor and wait 5ms.

If we iterate through this process at extreme speeds (an infinite loop inside `while(1)`), visually, both digits will appear illuminated simultaneously. That trick is known as **Multiplexing**:

Insert this inside `/* USER CODE BEGIN While */`:

```c
        /* USER CODE BEGIN While */
        
        // --- DIGIT 1 (Units) ---
        // 1. Prevent "ghosting effect" by turning OFF all selectors
        GPIOB->ODATA |= (1 << 8) | (1 << 9); 
        
        // 2. Load the data. We invert using "~" because it's Common Anode (turns on with 0).
        // And we mask with "& 0xFF" to avoid altering any high pins on Port A.
        GPIOA->ODATA = (GPIOA->ODATA & ~0xFF) | (~nums[5] & 0xFF);
        
        // 3. Turn ON the Units transistor (PB8) by writing a 0 to it.
        GPIOB->ODATA &= ~(1 << 8);
        
        // 4. Wait around 3 to 5ms. A longer duration creates a noticeable visual flicker.
        delay_ms(5); 

        // --- DIGIT 2 (Tens) ---
        // 1. Prevent "ghosting effect" by turning OFF all selectors.
        GPIOB->ODATA |= (1 << 8) | (1 << 9); 
        
        // 2. Load the data for the number 8 (for example).
        GPIOA->ODATA = (GPIOA->ODATA & ~0xFF) | (~nums[8] & 0xFF);
        
        // 3. Turn ON the Tens transistor (PB9) by writing a 0 to it.
        GPIOB->ODATA &= ~(1 << 9);
        
        // 4. Keeping the retina fooled.
        delay_ms(5);

        /* USER CODE END While */
```
