/**
 * Binary patching operations.
 *
 * All patches modify program bytearrays in-place and return
 * success/failure with messages.
 *
 * Ported from:
 *   - arduboy_toolset/arduboy/patch.py
 *   - Arduboy-Python-Utilities/uploader.py (SSD1309, Micro LED patches)
 */

import { RETI_BYTES, FX_DATA_PAGE_OFFSET, FX_SAVE_PAGE_OFFSET, DEVICE_DETECT, DEVICE_TYPE } from '../constants.js';
import { writeUint16BE } from '../utils/binary.js';

// =============================================================================
// SSD1309 Display Patch
// =============================================================================

/** LCD boot program signature to search for */
const LCD_BOOT_PATTERN = new Uint8Array([0xd5, 0xf0, 0x8d, 0x14, 0xa1, 0xc8, 0x81, 0xcf, 0xd9, 0xf1, 0xaf, 0x20, 0x00]);

/**
 * Patch hex data for SSD1309 displays.
 *
 * Searches for the LCD boot program pattern and changes charge pump
 * initialization bytes from 0x8D 0x14 (SSD1306) to 0xE3 0xE3 (SSD1309 NOP).
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchSSD1309(flashData) {
  let count = 0;

  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN.length; j++) {
      if (flashData[i + j] !== LCD_BOOT_PATTERN[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Replace charge pump bytes (offset +2 and +3 from pattern start)
      flashData[i + 2] = 0xe3; // NOP (was 0x8D — charge pump enable command)
      flashData[i + 3] = 0xe3; // NOP (was 0x14 — charge pump on)
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Patched ${count} LCD boot program(s) for SSD1309.` : 'LCD boot program pattern not found.',
  };
}

/** SSD1309-patched variant of the LCD boot pattern (charge pump bytes replaced with NOPs) */
const LCD_BOOT_PATTERN_1309 = new Uint8Array([0xd5, 0xf0, 0xe3, 0xe3, 0xa1, 0xc8, 0x81, 0xcf, 0xd9, 0xf1, 0xaf, 0x20, 0x00]);

/**
 * Reverse the SSD1309 patch — restore charge pump init for SSD1306 displays.
 *
 * Searches for the SSD1309-patched LCD boot pattern and restores the
 * original charge pump bytes from 0xE3 0xE3 (NOP) back to 0x8D 0x14 (SSD1306).
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @returns {{success: boolean, count: number, message: string}}
 */
export function unpatchSSD1309(flashData) {
  let count = 0;

  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN_1309.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN_1309.length; j++) {
      if (flashData[i + j] !== LCD_BOOT_PATTERN_1309[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      flashData[i + 2] = 0x8d; // Restore charge pump enable command
      flashData[i + 3] = 0x14; // Restore charge pump on
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Restored ${count} LCD boot program(s) for SSD1306.` : 'SSD1309 patch pattern not found.',
  };
}

/**
 * Detect whether a program binary has the SSD1309 patch applied.
 *
 * @param {Uint8Array} flashData - Program binary to check
 * @returns {boolean} True if the SSD1309-patched LCD boot pattern is found
 */
export function detectSSD1309Patch(flashData) {
  if (!flashData || flashData.length < LCD_BOOT_PATTERN_1309.length) return false;
  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN_1309.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN_1309.length; j++) {
      if (flashData[i + j] !== LCD_BOOT_PATTERN_1309[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Patch the contrast/brightness byte in the LCD boot program.
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @param {number} contrast - Contrast value (0x00–0xFF). Common: 0xCF=max, 0x7F=normal, 0x3F=dim, 0x1F=dimmer, 0x00=dimmest
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchContrast(flashData, contrast) {
  let count = 0;

  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN.length; j++) {
      // Allow the charge pump bytes to be already patched (0xE3)
      if (j === 2 || j === 3) continue;
      // Allow the contrast byte to be any value
      if (j === 7) continue;
      if (flashData[i + j] !== LCD_BOOT_PATTERN[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      flashData[i + 7] = contrast; // Contrast byte at offset 7
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Set contrast to 0x${contrast.toString(16)} in ${count} location(s).` : 'LCD boot program pattern not found.',
  };
}

// =============================================================================
// Arduino Micro LED Polarity Patch
// =============================================================================

/** SBI/CBI instruction patterns for RXLED and TXLED */
const RXLED_CBI = new Uint8Array([0x47, 0x9a]); // CBI PORTB, 0 (RXLED off)
const RXLED_SBI = new Uint8Array([0x47, 0x98]); // SBI PORTB, 0 (RXLED on)
const TXLED_CBI = new Uint8Array([0x35, 0x9a]); // CBI PORTD, 5 (TXLED off)
const TXLED_SBI = new Uint8Array([0x35, 0x98]); // SBI PORTD, 5 (TXLED on)

// =============================================================================
// FX ↔ Mini CS Pin Patch (Experimental)
// =============================================================================

/**
 * Patch the FX chip-select pin in a program binary to match a different device.
 *
 * Swaps SBI/CBI instructions between Arduboy FX (PORTE bit 2, SDA) and
 * Arduboy Mini (PORTD bit 1, HWB) chip-select pins.
 *
 * ⚠️ EXPERIMENTAL: This is a 2-byte pattern swap that could theoretically
 * produce false positives if the same byte pair appears as data (sprite pixels,
 * lookup tables, etc.) rather than as actual SBI/CBI instructions. In practice,
 * these byte combinations are uncommon in game data, but the risk is non-zero.
 *
 * @param {Uint8Array} flashData - Program binary (modified in-place)
 * @param {string} fromDevice - Source device type (DEVICE_TYPE.ARDUBOY_FX or DEVICE_TYPE.ARDUBOY_MINI)
 * @param {string} toDevice - Target device type
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchCSPin(flashData, fromDevice, toDevice) {
  // FX-C shares the same CS pin as Mini — normalize for patching
  const normFrom = fromDevice === DEVICE_TYPE.ARDUBOY_FX_C ? DEVICE_TYPE.ARDUBOY_MINI : fromDevice;
  const normTo   = toDevice   === DEVICE_TYPE.ARDUBOY_FX_C ? DEVICE_TYPE.ARDUBOY_MINI : toDevice;

  if (normFrom === normTo) {
    return { success: false, count: 0, message: 'Source and target device are the same.' };
  }

  // Determine which byte pairs to search for and replace with
  let srcEnable, srcDisable, dstEnable, dstDisable;

  if (normFrom === DEVICE_TYPE.ARDUBOY_FX && normTo === DEVICE_TYPE.ARDUBOY_MINI) {
    srcEnable  = DEVICE_DETECT.FX_ENABLE;
    srcDisable = DEVICE_DETECT.FX_DISABLE;
    dstEnable  = DEVICE_DETECT.MINI_ENABLE;
    dstDisable = DEVICE_DETECT.MINI_DISABLE;
  } else if (normFrom === DEVICE_TYPE.ARDUBOY_MINI && normTo === DEVICE_TYPE.ARDUBOY_FX) {
    srcEnable  = DEVICE_DETECT.MINI_ENABLE;
    srcDisable = DEVICE_DETECT.MINI_DISABLE;
    dstEnable  = DEVICE_DETECT.FX_ENABLE;
    dstDisable = DEVICE_DETECT.FX_DISABLE;
  } else {
    return { success: false, count: 0, message: `CS pin patch not applicable between ${fromDevice} and ${toDevice}.` };
  }

  let count = 0;

  // Phase 1: Patch SBI/CBI enable/disable instructions
  for (let i = 0; i <= flashData.length - 2; i++) {
    const b0 = flashData[i];
    const b1 = flashData[i + 1];

    if (b0 === srcEnable[0] && b1 === srcEnable[1]) {
      flashData[i]     = dstEnable[0];
      flashData[i + 1] = dstEnable[1];
      count++;
    } else if (b0 === srcDisable[0] && b1 === srcDisable[1]) {
      flashData[i]     = dstDisable[0];
      flashData[i + 1] = dstDisable[1];
      count++;
    }
  }

  // Phase 2: Patch bootPins() port initialization (LDI r24,K ; OUT PORTD/DDRD, r24)
  // FX uses PORTD bit 1 for CS, Mini uses PORTE bit 2 — the PORTD/DDRD setup
  // constants differ in bits 1 and 2 to configure the correct pin as output.
  // OUT PORTD, r24 = [0x8B, 0xB9], OUT DDRD, r24 = [0x8A, 0xB9]
  const OUT_PORTD = [0x8B, 0xB9];
  const OUT_DDRD  = [0x8A, 0xB9];
  let bootPinsCount = 0;

  for (let i = 0; i <= flashData.length - 4; i++) {
    const ldiLo  = flashData[i];
    const ldiHi  = flashData[i + 1];
    const outLo  = flashData[i + 2];
    const outHi  = flashData[i + 3];

    // Check for LDI r24, K (high nibble 0xE for LDI, low nibble 0x8 for r24)
    if ((ldiHi & 0xF0) !== 0xE0 || (ldiLo & 0xF0) !== 0x80) continue;

    // Check for OUT PORTD or OUT DDRD
    const isPortD = outLo === OUT_PORTD[0] && outHi === OUT_PORTD[1];
    const isDdrD  = outLo === OUT_DDRD[0]  && outHi === OUT_DDRD[1];
    if (!isPortD && !isDdrD) continue;

    // K bits 1 and 2 are in ldiLo bits 1 and 2 — swap them between FX and Mini
    const hasBit1 = (ldiLo & 0x02) !== 0;
    const hasBit2 = (ldiLo & 0x04) !== 0;

    if (normFrom === DEVICE_TYPE.ARDUBOY_FX && hasBit1 && !hasBit2) {
      flashData[i] = (ldiLo & ~0x02) | 0x04; // clear bit 1, set bit 2
      bootPinsCount++;
    } else if (normFrom === DEVICE_TYPE.ARDUBOY_MINI && hasBit2 && !hasBit1) {
      flashData[i] = (ldiLo & ~0x04) | 0x02; // clear bit 2, set bit 1
      bootPinsCount++;
    }
  }

  count += bootPinsCount;

  const PATCH_LABELS = { [DEVICE_TYPE.ARDUBOY_FX]: 'FX', [DEVICE_TYPE.ARDUBOY_FX_C]: 'FX-C', [DEVICE_TYPE.ARDUBOY_MINI]: 'Mini' };
  const fromLabel = PATCH_LABELS[fromDevice] || fromDevice;
  const toLabel   = PATCH_LABELS[toDevice]   || toDevice;

  return {
    success: count > 0,
    count,
    message: count > 0
      ? `Patched ${count} CS pin instruction(s) from ${fromLabel} → ${toLabel}${bootPinsCount ? ` (includes ${bootPinsCount} port init)` : ''}.`
      : `No ${fromLabel} CS pin patterns found to patch.`,
  };
}

/**
 * Patch LED polarity for Arduino Micro clones.
 * Swaps SBI ↔ CBI instructions for RXLED and TXLED pins.
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchMicroLed(flashData) {
  let count = 0;

  for (let i = 0; i <= flashData.length - 2; i++) {
    // RXLED: swap CBI ↔ SBI for PORTB bit 0
    if (flashData[i] === RXLED_CBI[0] && flashData[i + 1] === RXLED_CBI[1]) {
      flashData[i + 1] = RXLED_SBI[1]; // CBI → SBI
      count++;
    } else if (flashData[i] === RXLED_SBI[0] && flashData[i + 1] === RXLED_SBI[1]) {
      flashData[i + 1] = RXLED_CBI[1]; // SBI → CBI
      count++;
    }
    // TXLED: swap CBI ↔ SBI for PORTD bit 5
    if (flashData[i] === TXLED_CBI[0] && flashData[i + 1] === TXLED_CBI[1]) {
      flashData[i + 1] = TXLED_SBI[1]; // CBI → SBI
      count++;
    } else if (flashData[i] === TXLED_SBI[0] && flashData[i + 1] === TXLED_SBI[1]) {
      flashData[i + 1] = TXLED_CBI[1]; // SBI → CBI
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Swapped ${count} LED instruction(s) for Micro polarity.` : 'No LED instructions found to patch.',
  };
}

// =============================================================================
// FX Data/Save Page Patching
// =============================================================================

/**
 * Patch FX data and save page addresses into a program binary.
 * Used when building flash cart slots to tell the program where its
 * FX data and save data are located.
 *
 * @param {Uint8Array} program - Program binary (modified in-place)
 * @param {number|null} dataPage - FX data page number (null to skip)
 * @param {number|null} savePage - FX save page number (null to skip)
 */
export function patchFxPages(program, dataPage, savePage) {
  if (program.length < 0x1c) return;

  if (dataPage !== null && dataPage !== undefined) {
    program[FX_DATA_PAGE_OFFSET] = RETI_BYTES[0];
    program[FX_DATA_PAGE_OFFSET + 1] = RETI_BYTES[1];
    writeUint16BE(program, FX_DATA_PAGE_OFFSET + 2, dataPage);
  }

  if (savePage !== null && savePage !== undefined) {
    program[FX_SAVE_PAGE_OFFSET] = RETI_BYTES[0];
    program[FX_SAVE_PAGE_OFFSET + 1] = RETI_BYTES[1];
    writeUint16BE(program, FX_SAVE_PAGE_OFFSET + 2, savePage);
  }
}

// =============================================================================
// Menu Button Patch (Timer0 ISR replacement)
// =============================================================================

/**
 * The menu button patch AVR machine code (152 bytes).
 * Replaces the Timer0 ISR to detect UP+DOWN held for 2 seconds,
 * then jumps to the bootloader menu.
 *
 * Contains placeholder bytes for timer0_fract, timer0_millis, and
 * timer0_overflow_count addresses which must be patched per-sketch.
 *
 * Ported from: Arduboy-Python-Utilities/flashcart-builder.py
 */
export const MENU_BUTTON_PATCH = new Uint8Array([
  0x0f, 0x92, 0x0f, 0xb6, 0x8f, 0x93, 0x9f, 0x93, 0xef, 0x93, 0xff, 0x93, 0x80, 0x91, 0xcc, 0x01,
  0x8d, 0x5f, 0x8d, 0x37, 0x08, 0xf0, 0x8d, 0x57, 0x80, 0x93, 0xcc, 0x01, 0xe2, 0xe4, 0xf3, 0xe0,
  0x80, 0x81, 0x8e, 0x4f, 0x80, 0x83, 0x91, 0x81, 0x9f, 0x4f, 0x91, 0x83, 0x82, 0x81, 0x8f, 0x4f,
  0x82, 0x83, 0x83, 0x81, 0x8f, 0x4f, 0x83, 0x83, 0xed, 0xec, 0xf1, 0xe0, 0x80, 0x81, 0x8f, 0x5f,
  0x80, 0x83, 0x81, 0x81, 0x8f, 0x4f, 0x81, 0x83, 0x82, 0x81, 0x8f, 0x4f, 0x82, 0x83, 0x83, 0x81,
  0x8f, 0x4f, 0x83, 0x83, 0x8f, 0xb1, 0x8f, 0x60, 0x66, 0x99, 0x1c, 0x9b, 0x88, 0x27, 0x8f, 0x36,
  0x81, 0xf4, 0x80, 0x91, 0xFF, 0x0A, 0x98, 0x1b, 0x96, 0x30, 0x68, 0xf0, 0xe0, 0xe0, 0xf8, 0xe0,
  0x87, 0xe7, 0x80, 0x83, 0x81, 0x83, 0x88, 0xe1, 0x80, 0x93, 0x60, 0x00, 0xf0, 0x93, 0x60, 0x00,
  0xff, 0xcf, 0x90, 0x93, 0xFF, 0x0A, 0xff, 0x91, 0xef, 0x91, 0x9f, 0x91, 0x8f, 0x91, 0x0f, 0xbe,
  0x0f, 0x90, 0x18, 0x95,
]);

/** Offsets into MENU_BUTTON_PATCH where timer variable addresses are encoded */
const MBP_FRACT_LDS = 14;
const MBP_FRACT_STS = 26;
const MBP_MILLIS_R30 = 28;
const MBP_MILLIS_R31 = 30;
const MBP_OVERFLOW_R30 = 56;
const MBP_OVERFLOW_R31 = 58;

/**
 * Apply the menu button patch to a program binary.
 * Analyzes the Timer0 ISR (vector 23 at address 0x5E) to find
 * timer0_millis, timer0_fract, and timer0_overflow_count SRAM addresses,
 * then overwrites the ISR with the patch code that detects UP+DOWN
 * held for 2 seconds and jumps to the bootloader menu.
 *
 * Ported from: Arduboy-Python-Utilities/flashcart-builder.py PatchMenuButton()
 *
 * @param {Uint8Array} program - Program binary (modified in-place)
 * @returns {{success: boolean, message: string}}
 */
export function patchMenuButtons(program) {
  if (program.length < 256) {
    return { success: false, message: '' };
  }

  // Timer0 ISR vector is at interrupt vector 23 (address 0x5E-0x5F in the vector table)
  const vector23 = (program[0x5E] << 1) | (program[0x5F] << 9);
  let p = vector23;
  let l = 0;
  let ldsCount = 0;
  let branch = 0;
  let timer0Millis = 0;
  let timer0Fract = 0;
  let timer0OverflowCount = 0;

  while (p < program.length - 2) {
    p += 2; // handle 2-byte instructions

    // ret instruction (0x0895) — ISR contains a subroutine call, not patchable
    if (program[p - 2] === 0x08 && program[p - 1] === 0x95) {
      l = -1;
      break;
    }

    // brcc instruction that may jump beyond reti
    if ((program[p - 1] & 0xFC) === 0xF4 && (program[p - 2] & 0x07) === 0x00) {
      branch = ((program[p - 1] & 0x03) << 6) + ((program[p - 2] & 0xF8) >> 2);
      if (branch < 128) {
        branch = p + branch;
      } else {
        branch = p - 256 + branch;
      }
    }

    // reti instruction (0x1895)
    if (program[p - 2] === 0x18 && program[p - 1] === 0x95) {
      l = p - vector23;
      if (p > branch) { // no branch beyond reti
        break;
      }
    }

    // branched beyond reti — look for rjmp instruction
    if (l !== 0) {
      if ((program[p - 1] & 0xF0) === 0xC0) {
        l = p - vector23;
        break;
      }
    }

    // handle 4-byte instructions
    // lds instruction
    if ((program[p - 1] & 0xFE) === 0x90 && (program[p - 2] & 0x0F) === 0x00) {
      ldsCount++;
      if (ldsCount === 1) {
        timer0Millis = program[p] | (program[p + 1] << 8);
      } else if (ldsCount === 5) {
        timer0Fract = program[p] | (program[p + 1] << 8);
      } else if (ldsCount === 6) {
        timer0OverflowCount = program[p] | (program[p + 1] << 8);
      }
      p += 2;
    }
    // sts instruction
    if ((program[p - 1] & 0xFE) === 0x92 && (program[p - 2] & 0x0F) === 0x00) {
      p += 2;
    }
  }

  if (l === -1) {
    return { success: false, message: 'No menu patch applied. ISR contains subroutine.' };
  }
  if (l < MENU_BUTTON_PATCH.length) {
    return { success: false, message: `No menu patch applied. ISR size too small (${l} bytes).` };
  }
  if (timer0Millis === 0 || timer0Fract === 0 || timer0OverflowCount === 0) {
    return { success: false, message: 'No menu patch applied. Custom ISR in use.' };
  }

  // Overwrite the ISR with the menu button patch code
  program.set(MENU_BUTTON_PATCH, vector23);

  // Fix timer0_fract address (lds and sts operands)
  program[vector23 + MBP_FRACT_LDS + 0] = timer0Fract & 0xFF;
  program[vector23 + MBP_FRACT_LDS + 1] = timer0Fract >> 8;
  program[vector23 + MBP_FRACT_STS + 0] = timer0Fract & 0xFF;
  program[vector23 + MBP_FRACT_STS + 1] = timer0Fract >> 8;

  // Fix timer0_millis address (ldi r30/r31 operands)
  program[vector23 + MBP_MILLIS_R30 + 0] = 0xE0 | ((timer0Millis >> 0) & 0x0F);
  program[vector23 + MBP_MILLIS_R30 + 1] = 0xE0 | ((timer0Millis >> 4) & 0x0F);
  program[vector23 + MBP_MILLIS_R31 + 0] = 0xF0 | ((timer0Millis >> 8) & 0x0F);
  program[vector23 + MBP_MILLIS_R31 + 1] = 0xE0 | ((timer0Millis >> 12) & 0x0F);

  // Fix timer0_overflow_count address (ldi r30/r31 operands)
  program[vector23 + MBP_OVERFLOW_R30 + 0] = 0xE0 | ((timer0OverflowCount >> 0) & 0x0F);
  program[vector23 + MBP_OVERFLOW_R30 + 1] = 0xE0 | ((timer0OverflowCount >> 4) & 0x0F);
  program[vector23 + MBP_OVERFLOW_R31 + 0] = 0xF0 | ((timer0OverflowCount >> 8) & 0x0F);
  program[vector23 + MBP_OVERFLOW_R31 + 1] = 0xE0 | ((timer0OverflowCount >> 12) & 0x0F);

  return { success: true, message: 'Menu patch applied.' };
}

// =============================================================================
// Contrast Presets
// =============================================================================

/** Common contrast preset values */
export const CONTRAST_PRESETS = {
  MAX:     0xcf,
  NORMAL:  0x7f,
  DIM:     0x3f,
  DIMMER:  0x1f,
  DIMMEST: 0x00,
};

// =============================================================================
// Device Detection from Program Binary
// =============================================================================

/**
 * Detect the target hardware device from a compiled program binary.
 *
 * Scans for SPI chip-select SBI/CBI instruction byte patterns that indicate
 * whether the program was compiled for ArduboyFX (Port E bit 2) or
 * ArduboyMini (Port D bit 1). If neither pattern is found, the program
 * is assumed to target a plain Arduboy (no external flash).
 *
 * @param {Uint8Array} programRaw - Compiled program binary
 * @returns {string|null} DEVICE_TYPE value, or null if program is empty
 */
export function detectDeviceFromProgram(programRaw) {
  if (!programRaw || programRaw.length === 0) return null;

  let hasFx = false;
  let hasMini = false;

  for (let i = 0; i <= programRaw.length - 2; i++) {
    const b0 = programRaw[i];
    const b1 = programRaw[i + 1];

    if (b0 === DEVICE_DETECT.FX_ENABLE[0] &&
        (b1 === DEVICE_DETECT.FX_ENABLE[1] || b1 === DEVICE_DETECT.FX_DISABLE[1])) {
      hasFx = true;
    }
    if (b0 === DEVICE_DETECT.MINI_ENABLE[0] &&
        (b1 === DEVICE_DETECT.MINI_ENABLE[1] || b1 === DEVICE_DETECT.MINI_DISABLE[1])) {
      hasMini = true;
    }

    if (hasFx && hasMini) break;
  }

  if (hasMini) return DEVICE_TYPE.ARDUBOY_MINI;
  if (hasFx) return DEVICE_TYPE.ARDUBOY_FX;
  return DEVICE_TYPE.ARDUBOY;
}
