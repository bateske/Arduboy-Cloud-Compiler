/**
 * Export song model as ArduboyTones format.
 *
 * Generates a uint16_t[] PROGMEM array of frequency/duration pairs
 * compatible with the ArduboyTones library.
 */

import { tickToMs, sortNotes, resolveOverlaps, getSongEndTick } from './songModel.js';
import { midiNoteToFreq, midiNoteToConstant, midiNoteToConstantH, clampFreq } from './noteConstants.js';

/**
 * Convert duration in ms to ArduboyTones 1024ths of a second.
 * @param {number} ms
 * @returns {number}
 */
function msToDuration1024(ms) {
  return Math.round(ms * 1024 / 1000);
}

/**
 * Format a uint16_t value as a C hex literal: 0x0000–0xFFFF.
 * @param {number} v
 * @returns {string}
 */
function toHex16(v) {
  return '0x' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Emit frequency/duration pairs, splitting if duration exceeds uint16_t max.
 * @param {Array} pairs  Output array to push to
 * @param {number} freq  Frequency value (already includes high-volume bit if needed)
 * @param {number} dur1024  Duration in 1024ths
 * @param {string} freqStr  String representation for the frequency
 * @param {boolean} [hex=false]  Format duration values as hex
 */
function emitPairs(pairs, freq, dur1024, freqStr, hex = false) {
  while (dur1024 > 65535) {
    pairs.push({ freq, dur: 65535, freqStr, durStr: hex ? '0xFFFF' : '65535' });
    dur1024 -= 65535;
  }
  if (dur1024 > 0) {
    pairs.push({ freq, dur: dur1024, freqStr, durStr: hex ? toHex16(dur1024) : String(dur1024) });
  }
}

/**
 * Emit rest pairs (freq=0).
 * @param {Array} pairs
 * @param {number} ms  Rest duration in milliseconds
 * @param {boolean} [useConstants=true]  Use NOTE_REST constant name
 */
function emitRestPairs(pairs, ms, useConstants = true) {
  let dur1024 = msToDuration1024(ms);
  emitPairs(pairs, 0, dur1024, useConstants ? 'NOTE_REST' : '0x0000', !useConstants);
}

/**
 * Export the song model to ArduboyTones C code.
 *
 * @param {Object} song  Song model
 * @param {Object} [opts]
 * @param {string} [opts.arrayName='song']
 * @param {boolean} [opts.useConstants=true]  Use NOTE_* constant names
 * @param {number} [opts.highVolumeThreshold=96]  Velocity threshold for high volume
 * @returns {{ code: string, exampleCode: string, warnings: string[], byteCount: number }}
 */
export function exportArduboyTones(song, opts = {}) {
  const {
    arrayName = 'song',
    useConstants = true,
    highVolumeThreshold = 96,
  } = opts;

  const warnings = [];

  // Use only the first track
  if (song.tracks.length === 0) {
    const end = useConstants ? 'TONES_END' : '0x8000';
    const emptyCode = `const uint16_t ${arrayName}[] PROGMEM = {\n  ${end}\n};`;
    return {
      code: emptyCode,
      exampleCode: generateTonesExampleMinimal(arrayName),
      exampleCodeFull: generateTonesExampleFull(arrayName, emptyCode),
      warnings: ['No tracks in song'],
      byteCount: 2,
    };
  }

  // Work on a copy to avoid mutating the original
  const track = {
    ...song.tracks[0],
    notes: song.tracks[0].notes.filter(n => !n.muted).map(n => ({ ...n })),
  };
  resolveOverlaps(track);
  const sorted = sortNotes(track.notes);

  if (sorted.length === 0) {
    const end = useConstants ? 'TONES_END' : '0x8000';
    const emptyCode = `const uint16_t ${arrayName}[] PROGMEM = {\n  ${end}\n};`;
    return {
      code: emptyCode,
      exampleCode: generateTonesExampleMinimal(arrayName),
      exampleCodeFull: generateTonesExampleFull(arrayName, emptyCode),
      warnings: ['No notes to export'],
      byteCount: 2,
    };
  }

  const pairs = [];
  let prevEndMs = 0;

  for (const note of sorted) {
    const startMs = tickToMs(note.startTick, song.tempoMap, song.ppq);
    const endMs = tickToMs(note.endTick, song.tempoMap, song.ppq);

    // Insert rest for gaps
    const gapMs = startMs - prevEndMs;
    if (gapMs > 1) {
      emitRestPairs(pairs, gapMs, useConstants);
    }

    // Emit note
    const rawFreq = clampFreq(midiNoteToFreq(note.noteNumber));
    const isHighVol = note.velocity >= highVolumeThreshold;

    let freqStr;
    if (useConstants) {
      freqStr = isHighVol
        ? midiNoteToConstantH(note.noteNumber)
        : midiNoteToConstant(note.noteNumber);
    } else {
      freqStr = toHex16(isHighVol ? (rawFreq | 0x8000) : rawFreq);
    }

    const freqValue = isHighVol ? (rawFreq | 0x8000) : rawFreq;
    const durMs = endMs - startMs;
    const dur1024 = msToDuration1024(durMs);

    if (dur1024 <= 0) {
      warnings.push(`Zero-duration note at tick ${note.startTick} skipped`);
      continue;
    }

    emitPairs(pairs, freqValue, dur1024, freqStr, !useConstants);
    prevEndMs = endMs;
  }

  // Terminator  (TONES_END = 0x8000, TONES_REPEAT = 0x8001)
  const terminator = song.loopEnabled
    ? (useConstants ? 'TONES_REPEAT' : '0x8001')
    : (useConstants ? 'TONES_END' : '0x8000');

  // Format code
  const lines = [];
  for (let i = 0; i < pairs.length; i += 4) {
    const chunk = pairs.slice(i, i + 4);
    const parts = chunk.map(p => `${p.freqStr}, ${p.durStr}`);
    lines.push('  ' + parts.join(',  '));
  }

  const code = `const uint16_t ${arrayName}[] PROGMEM = {\n${lines.join(',\n')},\n  ${terminator}\n};`;

  // Byte count: each pair = 2 uint16_t = 4 bytes, terminator = 2 bytes
  const byteCount = pairs.length * 4 + 2;

  if (byteCount > 28000) {
    warnings.push(`Array is ${byteCount} bytes — may exceed Arduboy program memory`);
  }

  return {
    code,
    exampleCode: generateTonesExampleMinimal(arrayName),
    exampleCodeFull: generateTonesExampleFull(arrayName, code),
    warnings,
    byteCount,
  };
}

function generateTonesExampleMinimal(arrayName) {
  return `sound.tones(${arrayName});`;
}

function generateTonesExampleSimple(arrayName) {
  return `// Declare the array as a global:
// const uint16_t ${arrayName}[] PROGMEM = { ... };

void playMusicButtonExample() {
  static ArduboyTones sound(arduboy.audio.enabled);
  static boolean isPlaying = false;

  if (arduboy.justPressed(A_BUTTON)) {
    sound.tones(${arrayName});
    isPlaying = true;
  }
  
  if (arduboy.justPressed(B_BUTTON)) {
    sound.noTone();
    isPlaying = false;
  }
  
  // Check if music finished playing
  if (!sound.playing()) {
    isPlaying = false;
  }

  // Display button hints
  arduboy.setCursor(0, 0);
  arduboy.print(isPlaying ? F("Playing...") : F("Stopped"));
  arduboy.setCursor(0, 48);
  arduboy.print(F("A: Play  B: Stop"));
}`;
}

function generateTonesExampleFull(arrayName, arrayCode) {
  return `#include <Arduboy2.h>
#include <ArduboyTones.h>

Arduboy2 arduboy;
ArduboyTones sound(arduboy.audio.enabled);

// Song array
${arrayCode}

boolean isMusicPlaying = false;

void setup() {
  arduboy.begin();
  arduboy.audio.on();
}

void loop() {
  if (!arduboy.nextFrame()) return;
  arduboy.pollButtons();
  
  // A button: play/restart
  if (arduboy.justPressed(A_BUTTON)) {
    sound.tones(${arrayName});
    isMusicPlaying = true;
  }
  
  // B button: stop
  if (arduboy.justPressed(B_BUTTON)) {
    sound.noTone();
    isMusicPlaying = false;
  }
  
  // Check if music finished
  if (!sound.playing()) {
    isMusicPlaying = false;
  }

  arduboy.clear();

  // Display button hints
  arduboy.setCursor(0, 0);
  arduboy.print(isMusicPlaying ? F("Playing...") : F("Stopped"));
  arduboy.setCursor(0, 48);
  arduboy.print(F("A: Play  B: Stop"));

  arduboy.display();
}`;
}
