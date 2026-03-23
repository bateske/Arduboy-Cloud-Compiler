/**
 * Test script for bitmap-detector.js
 * Run with: node web/test-bitmap-detector.js
 * Requires no dependencies (uses the IIFE module pattern).
 */

// Polyfill ImageData for Node.js (not available in Node)
if (typeof ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor(a, b, c) {
      if (a instanceof Uint8ClampedArray) {
        this.data = a;
        this.width = b;
        this.height = c;
      } else {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      }
    }
  };
}

// Load the module (sets window.BitmapDetector)
global.window = global;
global.tabs = [];
require('./bitmap-detector.js');

var BD = window.BitmapDetector;
var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('FAIL: ' + message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 1: Parse a simple Sprites array (converter output format)
// ═══════════════════════════════════════════════════════════════════════════

var test1Source = [
  '// 8x8, 1 frame(s), 10 bytes',
  '// Render with: Sprites::drawOverwrite(x, y, sprite, frame);',
  'const uint8_t PROGMEM sprite[] = {',
  '  8, 8,',
  '  0x1c, 0x3e, 0x7f, 0x5f, 0x4f, 0x26, 0x1c, 0x00,',
  '};',
].join('\n');

var arrays1 = BD.Parser.parseArrays(test1Source);
assert(arrays1.length === 1, 'Test 1: should find 1 array');
assert(arrays1[0].name === 'sprite', 'Test 1: name should be "sprite"');
assert(arrays1[0].bytes.length === 10, 'Test 1: should have 10 bytes (2 header + 8 data)');
assert(arrays1[0].bytes[0] === 8, 'Test 1: first byte (width) should be 8');
assert(arrays1[0].bytes[1] === 8, 'Test 1: second byte (height) should be 8');
assert(arrays1[0].commentHeader !== null, 'Test 1: should have comment header');
assert(arrays1[0].startLine === 1, 'Test 1: startLine should be 1');
assert(arrays1[0].endLine === 6, 'Test 1: endLine should be 6');

var detection1 = BD.Engine.analyzeArray(arrays1[0], test1Source);
assert(detection1.format === 'spritesOverwrite', 'Test 1: format should be spritesOverwrite');
assert(detection1.width === 8, 'Test 1: width should be 8');
assert(detection1.height === 8, 'Test 1: height should be 8');
assert(detection1.confidence >= 50, 'Test 1: confidence should be >= 50 (is ' + detection1.confidence + ')');
assert(detection1.frameCount === 1, 'Test 1: frameCount should be 1');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 2: Parse HardwareTest-style array (unsigned char, separate brace)
// ═══════════════════════════════════════════════════════════════════════════

var test2Source = [
  'const unsigned char PROGMEM button_gfx[] =',
  '{',
  '// width, height,',
  '8, 8,',
  '0x1c, 0x3e, 0x7f, 0x5f, 0x4f, 0x26, 0x1c, 0x00,',
  '};',
].join('\n');

var arrays2 = BD.Parser.parseArrays(test2Source);
assert(arrays2.length === 1, 'Test 2: should find 1 array');
assert(arrays2[0].name === 'button_gfx', 'Test 2: name should be "button_gfx"');
assert(arrays2[0].bytes.length === 10, 'Test 2: should have 10 bytes');
assert(arrays2[0].bytes[0] === 8, 'Test 2: width byte should be 8');

var detection2 = BD.Engine.analyzeArray(arrays2[0], test2Source);
assert(detection2.width === 8, 'Test 2: width should be 8');
assert(detection2.height === 8, 'Test 2: height should be 8');
assert(detection2.confidence >= 20, 'Test 2: confidence should be >= 20 (is ' + detection2.confidence + ')');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 3: Parse Arduboy2Data.cpp class-qualified array
// ═══════════════════════════════════════════════════════════════════════════

var test3Source = [
  '// arduboy_logo.png',
  '// drawBitmap() format',
  '// 88x16 px (176 bytes)',
  'const PROGMEM uint8_t Arduboy2Base::arduboy_logo[] = {',
  '  0xF0, 0xF8, 0x9C, 0x8E, 0x87, 0x83, 0x87, 0x8E, 0x9C, 0xF8,',
  '  0xF0, 0x00,',
  '};',
].join('\n');

var arrays3 = BD.Parser.parseArrays(test3Source);
assert(arrays3.length === 1, 'Test 3: should find 1 array');
assert(arrays3[0].name === 'arduboy_logo', 'Test 3: name should be "arduboy_logo"');
assert(arrays3[0].commentHeader !== null, 'Test 3: should have comment header');

var detection3 = BD.Engine.analyzeArray(arrays3[0], test3Source);
assert(detection3.format === 'drawBitmap', 'Test 3: format should be drawBitmap');
assert(detection3.width === 88, 'Test 3: width should be 88');
assert(detection3.height === 16, 'Test 3: height should be 16');
assert(detection3.confidence >= 50, 'Test 3: confidence should be >= 50 (is ' + detection3.confidence + ')');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 4: Codec round-trip (unpack → pack → compare)
// ═══════════════════════════════════════════════════════════════════════════

// Simple 8x8 vertical bitmap
var testBytes = [0x1c, 0x3e, 0x7f, 0x5f, 0x4f, 0x26, 0x1c, 0x00];
var imgData = BD.Codec.unpackVertical(testBytes, 8, 8);
assert(imgData.width === 8, 'Test 4: decoded width should be 8');
assert(imgData.height === 8, 'Test 4: decoded height should be 8');

// Re-encode
var reEncoded = BD.Codec.packVertical(imgData, 8, 8);
assert(reEncoded.imageBytes.length === 8, 'Test 4: re-encoded should have 8 bytes');
for (var i = 0; i < testBytes.length; i++) {
  assert(reEncoded.imageBytes[i] === testBytes[i],
    'Test 4: byte ' + i + ' should match (got 0x' + reEncoded.imageBytes[i].toString(16) +
    ' expected 0x' + testBytes[i].toString(16) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 5: Horizontal codec round-trip
// ═══════════════════════════════════════════════════════════════════════════

// Simple 16x2 horizontal bitmap
var hBytes = [0xFF, 0x00, 0xAA, 0x55]; // 2 bytes per row, 2 rows
var hImg = BD.Codec.unpackHorizontal(hBytes, 16, 2);
assert(hImg.width === 16, 'Test 5: decoded width should be 16');
assert(hImg.height === 2, 'Test 5: decoded height should be 2');

var hReEncoded = BD.Codec.packHorizontal(hImg, 16, 2);
assert(hReEncoded.length === 4, 'Test 5: re-encoded should have 4 bytes');
for (var j = 0; j < hBytes.length; j++) {
  assert(hReEncoded[j] === hBytes[j],
    'Test 5: byte ' + j + ' should match (got 0x' + hReEncoded[j].toString(16) +
    ' expected 0x' + hBytes[j].toString(16) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 6: Plus-mask de-interleave and re-interleave
// ═══════════════════════════════════════════════════════════════════════════

var pmBytes = [0xAA, 0xFF, 0x55, 0xFF, 0x33, 0xCC, 0x11, 0xEE];
var separated = BD.Codec.deinterleavePlusMask(pmBytes);
assert(separated.imageBytes.length === 4, 'Test 6: should have 4 image bytes');
assert(separated.maskBytes.length === 4, 'Test 6: should have 4 mask bytes');
assert(separated.imageBytes[0] === 0xAA, 'Test 6: first image byte should be 0xAA');
assert(separated.maskBytes[0] === 0xFF, 'Test 6: first mask byte should be 0xFF');

var reInterleaved = BD.Codec.interleavePlusMask(separated.imageBytes, separated.maskBytes);
assert(reInterleaved.length === 8, 'Test 6: re-interleaved should have 8 bytes');
for (var k = 0; k < pmBytes.length; k++) {
  assert(reInterleaved[k] === pmBytes[k], 'Test 6: byte ' + k + ' should match');
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 7: Draw call scanning
// ═══════════════════════════════════════════════════════════════════════════

var drawCallSource = [
  'void draw() {',
  '  arduboy.drawBitmap(0, 0, logo, 88, 16, WHITE);',
  '  Sprites::drawOverwrite(10, 20, player, 0);',
  '  Sprites::drawPlusMask(30, 40, bullet, currentFrame);',
  '  Sprites::drawExternalMask(50, 60, enemy, enemyMask, 0, 0);',
  '}',
].join('\n');

var calls = BD.Engine.scanDrawCalls(drawCallSource);
assert(calls['logo'] !== undefined, 'Test 7: should find logo draw call');
assert(calls['logo'][0].format === 'drawBitmap', 'Test 7: logo format should be drawBitmap');
assert(calls['logo'][0].width === 88, 'Test 7: logo width should be 88');
assert(calls['logo'][0].height === 16, 'Test 7: logo height should be 16');
assert(calls['player'] !== undefined, 'Test 7: should find player draw call');
assert(calls['player'][0].format === 'spritesOverwrite', 'Test 7: player format should be spritesOverwrite');
assert(calls['bullet'] !== undefined, 'Test 7: should find bullet draw call');
assert(calls['bullet'][0].format === 'spritesPlusMask', 'Test 7: bullet format should be spritesPlusMask');
assert(calls['enemy'] !== undefined, 'Test 7: should find enemy draw call');
assert(calls['enemy'][0].format === 'spritesExternalMask', 'Test 7: enemy format should be spritesExternalMask');
assert(calls['enemy'][0].maskName === 'enemyMask', 'Test 7: enemy mask should be "enemyMask"');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 8: Dimension constants scanning
// ═══════════════════════════════════════════════════════════════════════════

var constSource = [
  'constexpr uint8_t spriteWidth = 16;',
  'constexpr uint8_t spriteHeight = 24;',
  '#define LOGO_WIDTH 88',
  '#define LOGO_HEIGHT 16',
].join('\n');

var dims1 = BD.Engine.scanDimensionConstants(constSource, 'sprite');
assert(dims1.width === 16, 'Test 8: sprite width should be 16');
assert(dims1.height === 24, 'Test 8: sprite height should be 24');

var dims2 = BD.Engine.scanDimensionConstants(constSource, 'logo');
assert(dims2.width === 88, 'Test 8: logo width should be 88');
assert(dims2.height === 16, 'Test 8: logo height should be 16');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 9: False positive — non-bitmap array should score low
// ═══════════════════════════════════════════════════════════════════════════

var nonBitmapSource = [
  'const uint8_t PROGMEM sineTable[] = {',
  '  0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33,',
  '  36, 39, 42, 45, 48, 51, 54, 57, 59, 62, 65, 67,',
  '  70, 73, 75, 78, 80, 82, 85, 87, 89, 91, 94, 96,',
  '  98, 100, 102, 104, 105, 107, 109, 111, 112, 114, 115, 117,',
  '  118, 119, 120, 122, 123, 124, 124, 125, 126, 126, 127, 127,',
  '  127, 128, 128, 128,',
  '};',
].join('\n');

var arrays9 = BD.Parser.parseArrays(nonBitmapSource);
assert(arrays9.length === 1, 'Test 9: should find 1 array');
var detection9 = BD.Engine.analyzeArray(arrays9[0], nonBitmapSource);
assert(detection9.confidence < 30, 'Test 9: sineTable confidence should be < 30 (is ' + detection9.confidence + ')');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 10: Multi-frame sprites
// ═══════════════════════════════════════════════════════════════════════════

var test10Source = [
  '// 8x8, 3 frame(s), 26 bytes',
  '// Render with: Sprites::drawOverwrite(x, y, walk, frame);',
  'const uint8_t PROGMEM walk[] = {',
  '  8, 8,',
  '  // Frame 0',
  '  0x00, 0x3c, 0x42, 0x42, 0x42, 0x42, 0x3c, 0x00,',
  '  // Frame 1',
  '  0x00, 0x3c, 0x46, 0x46, 0x46, 0x46, 0x3c, 0x00,',
  '  // Frame 2',
  '  0x00, 0x3c, 0x62, 0x62, 0x62, 0x62, 0x3c, 0x00,',
  '};',
].join('\n');

var arrays10 = BD.Parser.parseArrays(test10Source);
assert(arrays10.length === 1, 'Test 10: should find 1 array');
assert(arrays10[0].bytes.length === 26, 'Test 10: should have 26 bytes');

var detection10 = BD.Engine.analyzeArray(arrays10[0], test10Source);
assert(detection10.frameCount === 3, 'Test 10: frameCount should be 3 (is ' + detection10.frameCount + ')');
assert(detection10.width === 8, 'Test 10: width should be 8');
assert(detection10.height === 8, 'Test 10: height should be 8');
assert(detection10.confidence >= 50, 'Test 10: confidence should be >= 50 (is ' + detection10.confidence + ')');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 11: Full decode → encode round-trip for Sprites format
// ═══════════════════════════════════════════════════════════════════════════

var spriteDetection = {
  format: 'spritesOverwrite',
  width: 8,
  height: 8,
  frameCount: 1,
};
var spriteArrayInfo = arrays1[0]; // From test 1

var decoded = BD.Codec.decode(spriteArrayInfo, spriteDetection);
assert(decoded !== null, 'Test 11: decoded should not be null');
assert(decoded.width === 8, 'Test 11: decoded width should be 8');
assert(decoded.height === 8, 'Test 11: decoded height should be 8');

var encoded = BD.Codec.encode(decoded, spriteArrayInfo, spriteDetection);
// Compare re-encoded bytes to original data (skip header bytes)
var origData = spriteArrayInfo.bytes.slice(2);
assert(encoded.imageBytes.length === origData.length,
  'Test 11: re-encoded length should match (got ' + encoded.imageBytes.length + ' expected ' + origData.length + ')');
for (var ri = 0; ri < origData.length; ri++) {
  assert(encoded.imageBytes[ri] === origData[ri],
    'Test 11: byte ' + ri + ' mismatch (got 0x' + encoded.imageBytes[ri].toString(16) +
    ' expected 0x' + origData[ri].toString(16) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 12: Dimension candidate generation
// ═══════════════════════════════════════════════════════════════════════════

// A 128-byte array with no comments or draw calls — ambiguous
var ambiguousSource = [
  'const uint8_t PROGMEM mystery[] = {',
  '  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,',
  '  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,',
].join('\n');
// Pad to 128 bytes
var hexPad = [];
for (var hp = 16; hp < 128; hp++) {
  hexPad.push('0x' + (hp & 0xFF).toString(16).padStart(2, '0'));
}
ambiguousSource += '\n  ' + hexPad.join(', ') + ',\n};';

var arrays12 = BD.Parser.parseArrays(ambiguousSource);
assert(arrays12.length === 1, 'Test 12: should find 1 array');
assert(arrays12[0].bytes.length === 128, 'Test 12: should have 128 bytes');

var detection12 = BD.Engine.analyzeArray(arrays12[0], ambiguousSource);
assert(detection12.dimensionCandidates.length > 0, 'Test 12: should generate dimension candidates');
// 128 bytes: common factorizations include 16x8 (128 = 16*8/8*8 = nope, 16*8=128, strips=1, bpf=16),
// Actually 128 = w * (h/8) with many options: 128x8 (1 strip), 64x16 (2 strips), 32x32 (4), 16x64 (8), 8x128 (nope >128)
// Also with header: bytes[0]=0, bytes[1]=1 which aren't valid dims so no header match
var foundCandidate = false;
for (var ci = 0; ci < detection12.dimensionCandidates.length; ci++) {
  var c = detection12.dimensionCandidates[ci];
  if (c.w * (Math.ceil(c.h / 8)) === 128 || c.w * Math.ceil(c.h / 8) === 128) {
    foundCandidate = true;
    break;
  }
}
assert(foundCandidate, 'Test 12: at least one candidate should have valid w*strips=128');

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 13: Python image-converter.py format (constexpr width/height)
// ═══════════════════════════════════════════════════════════════════════════

var test13Source = [
  'constexpr uint8_t spriteWidth = 16;',
  'constexpr uint8_t spriteHeight = 16;',
  '',
  'const uint8_t PROGMEM sprite[] = {',
  '  16, 16,',
  '  //Frame 0',
  '  0xff, 0xff, 0x03, 0x05, 0x09, 0x11, 0x21, 0x41,',
  '  0x81, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0xff,',
  '  0xff, 0xff, 0xc0, 0xa0, 0x90, 0x88, 0x84, 0x82,',
  '  0x81, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xff,',
  '};',
].join('\n');

var arrays13 = BD.Parser.parseArrays(test13Source);
assert(arrays13.length === 1, 'Test 13: should find 1 array (got ' + arrays13.length + ')');
assert(arrays13[0].name === 'sprite', 'Test 13: name should be "sprite"');

var detection13 = BD.Engine.analyzeArray(arrays13[0], test13Source);
assert(detection13.width === 16, 'Test 13: width should be 16 (is ' + detection13.width + ')');
assert(detection13.height === 16, 'Test 13: height should be 16 (is ' + detection13.height + ')');
assert(detection13.confidence >= 30, 'Test 13: confidence should be >= 30 (is ' + detection13.confidence + ')');

// ═══════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
