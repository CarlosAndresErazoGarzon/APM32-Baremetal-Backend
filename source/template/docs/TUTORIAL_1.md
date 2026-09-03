# Tutorial 1: Inputs, Outputs, and Combinational Logic

**Objective:** Understand GPIO pin configuration at the register level and apply a truth table for conditional turning on of actuators (LEDs) using binary sensors (Buttons).

**Based on the Fritzing Diagram:**
![LEDs and Buttons Setup](./img/1_LED-SW_bb.png)

- **Sensor 1 (Button 1):** `PB10`
- **Sensor 2 (Button 2):** `PB11`
- **Actuator 1 (LED 1):** `PB12`
- **Actuator 2 (LED 2):** `PB13`
- **Actuator 3 (LED 3):** `PB14`
- **Actuator 4 (LED 4):** `PB15`

---

## Proposed Truth Table

We will implement the following logic in our main infinite loop:

|   Button 1 (PB10) |   Button 2 (PB11) | Action Required                                                     |
| :---------------: | :---------------: | :------------------------------------------------------------------ |
| 0 (Not pressed)   | 0 (Not pressed)   | **All LEDs OFF.**                                                   |
|  1 (Pressed)      | 0 (Not pressed)   | Turn ON **LED 1 & 2** (`PB12`, `PB13`). Rest OFF.                   |
| 0 (Not pressed)   |  1 (Pressed)      | Turn ON **LED 3 & 4** (`PB14`, `PB15`). Rest OFF.                   |
|  1 (Pressed)      |  1 (Pressed)      | **All LEDs ON.**                                                    |

*(We will assume inverted logic on the buttons due to pull-up resistors, which means "Pressed" equals a logic low level / `0`).*

---

## Step 1: Configuring Registers in `main.c`

Every time you interact with a pin, you must answer three questions:

1. Which Port does it belong to, and is its clock enabled in `RCM`?
2. Is it a low pin (0 to 7) configured in `CFGLOW`, or a high pin (8 to 15) configured in `CFGHIG`?
3. What hex code configures it as an Input / Output?

Both of our hex codes below live in the same register (`CFGHIG`, since PB10-PB15 are all "high" pins) but mean opposite things -- here's the exact bit-by-bit difference between a Pull-Up **input** (`0x8`, used for the buttons) and a Push-Pull **output** (`0x3`, used for the LEDs). Check the **PIN MODES** tab for the complete CNF/MODE reference if this is your first time reading one of these.

<div style="overflow-x:auto; margin: 1.5em 0;">
<svg viewBox="0 0 648 190" width="100%" style="max-width: 648px; display:block; margin: 0 auto; font-family: 'Inconsolata', monospace;" role="img" aria-label="CFGHIG bit layout for PB10 (bits 11-8, 0x8: Input Pull-up/Pull-down) and PB12 (bits 19-16, 0x3: Output Push-Pull 50MHz)">
  <!-- PB10 nibble (bits 11-8) -- Input, Pull-up/Pull-down -->
  <text x="168" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent-text)">PB10 -- bits 11..8 (Input)</text>
  <path d="M 24 22 L 24 30 L 312 30 L 312 22" fill="none" stroke="var(--accent-text)" stroke-width="1.5"/>
  <!-- PB12 nibble (bits 19-16) -- Output, Push-Pull -->
  <text x="480" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="var(--success-text)">PB12 -- bits 19..16 (Output)</text>
  <path d="M 336 22 L 336 30 L 624 30 L 624 22" fill="none" stroke="var(--success-text)" stroke-width="1.5"/>
  <!-- Bit index labels -->
  <g font-size="11" fill="var(--sidebar-text)" text-anchor="middle">
    <text x="60" y="46">11</text><text x="132" y="46">10</text><text x="204" y="46">9</text><text x="276" y="46">8</text>
    <text x="372" y="46">19</text><text x="444" y="46">18</text><text x="516" y="46">17</text><text x="588" y="46">16</text>
  </g>
  <!-- Value boxes: PB10=0x8=1000, PB12=0x3=0011 (read as CNF1,CNF0,MODE1,MODE0) -->
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
    <text x="60" y="83">1</text><text x="132" y="83">0</text><text x="204" y="83">0</text><text x="276" y="83">0</text>
    <text x="372" y="83">0</text><text x="444" y="83">0</text><text x="516" y="83">1</text><text x="588" y="83">1</text>
  </g>
  <!-- CNF/MODE sub-labels under each bit -->
  <g font-size="9" fill="var(--text-muted)" text-anchor="middle">
    <text x="60" y="112">CNF1</text><text x="132" y="112">CNF0</text><text x="204" y="112">MODE1</text><text x="276" y="112">MODE0</text>
    <text x="372" y="112">CNF1</text><text x="444" y="112">CNF0</text><text x="516" y="112">MODE1</text><text x="588" y="112">MODE0</text>
  </g>
  <!-- Legend -->
  <g font-size="12" fill="var(--text-main)">
    <text x="24" y="145">0x8 (PB10) = 0b1000 -&gt; MODE[1:0]=00 (Input), CNF[1:0]=10 (Pull-up/Pull-down)</text>
    <text x="24" y="164" fill="var(--text-muted)">0x3 (PB12) = 0b0011 -&gt; MODE[1:0]=11 (Output, 50MHz), CNF[1:0]=00 (Push-Pull)</text>
    <text x="24" y="182" fill="var(--text-muted)">Same register (CFGHIG), same 4-bit-per-pin format -- opposite meaning depending on which nibble you're looking at.</text>
  </g>
</svg>
</div>

Insert the following code inside the `/* USER CODE BEGIN Init */` block:

```c
/* USER CODE BEGIN Init */

// 1. ENABLE CLOCK FOR PORT B
RCM->APB2CLKEN |= (1 << 3); // Enable Port B (Bit 3)

// 2. CONFIGURE EVERYTHING IN CFGHIG AT ONCE
// In this setup, ALL our connections are in the upper half of Port B.
// Buttons: PB10, PB11 (Bits 8 to 15 in CFGHIG) -> Inputs with Pull-Up (0x8)
// LEDs: PB12, PB13, PB14, PB15 (Bits 16 to 31 in CFGHIG) -> 50MHz Outputs (0x3)

// Clear the upper 24 bits of CFGHIG (corresponding to PB10-PB15)
GPIOB->CFGHIG &= ~(0xFFFFFF << 8); 

// Assign the configuration: 0x3333 for the LEDs and 0x88 for the buttons
GPIOB->CFGHIG |= (0x333388 << 8);

// 3. ACTIVATE PULL-UPS FOR THE BUTTONS
// Sending a "1" to the ODATA register on input pins activates the internal Pull-Up resistor
GPIOB->ODATA |= (1 << 10) | (1 << 11); 

/* USER CODE END Init */
```

---

## Step 2: Reading and Implementing Control Logic

Now that the hardware has been programmed to obey us, we proceed to the infinite loop (the core program). In each cycle, we will read the state of `PB10` and `PB11` using the `IDATA` register and apply the decision based on our truth table.

Insert this inside the `/* USER CODE BEGIN While */` block:

```c
        /* USER CODE BEGIN While */

        // 1. Read Inputs
        // To check a specific bit we use: (Register & (1 << BitIndex))
        // Since we use internal Pull-Ups, if the button is pressed, the value drops to 0.
        int button1_pressed = !(GPIOB->IDATA & (1 << 10));
        int button2_pressed = !(GPIOB->IDATA & (1 << 11));

        // 2. Clear all LEDs first (to keep the IF statement short)
        GPIOB->ODATA &= ~((1 << 12) | (1 << 13) | (1 << 14) | (1 << 15));

        // 3. Apply Multiple Conditions
        if (button1_pressed && button2_pressed) {
            // Turn all ON = Send 1 to the ODATA register for all 4 pins
            GPIOB->ODATA |= (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15);
        }
        else if (button1_pressed) {
            // Turn ON only PB12 and PB13
            GPIOB->ODATA |= (1 << 12) | (1 << 13);
        }
        else if (button2_pressed) {
            // Turn ON only PB14 and PB15
            GPIOB->ODATA |= (1 << 14) | (1 << 15);
        }
        // The 'else' case (neither pressed) requires no code because we already turned them OFF in step 2!

        /* USER CODE END While */
```

## Baremetal Behavior Summary

As you can see, **there are no functions** like `digitalRead()` or `pinMode()`. The code interacts physically by altering base memory transistors (registers) at extreme speeds. This is the heart of real embedded programming!
