// webtools/src/core/bitmapFont.js
// Bitmap font loading and text rendering for 1-bit pixel fonts.

const FONT_MANIFEST_FILES = [
  '/assets/fonts/SmallestPixel4x5.json',
  '/assets/fonts/Stylish6x5.json',
  '/assets/fonts/MinimalFont5x7.json',
  '/assets/fonts/MonoBold8x8.json',
  '/assets/fonts/PixelsRUs6x12.json',
  '/assets/fonts/TomAndJerry14x10.json',
  '/assets/fonts/DeadStock18px.json',
];

/**
 * Load a single bitmap font manifest from a URL.
 * Returns { id, family, ppem, glyphs: Map<codepoint, Glyph>, maxTop, maxHeight }
 */
export async function loadBitmapFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font: ${url}`);
  const manifest = await res.json();

  const glyphs = new Map();
  let maxTop = 0;
  let maxHeight = 0;

  for (const g of manifest.glyphs) {
    glyphs.set(g.codepoint, g);
    if (g.bitmap.top > maxTop) maxTop = g.bitmap.top;
    const totalH = g.bitmap.top + (g.bitmap.height - g.bitmap.top);
    if (g.bitmap.height > maxHeight) maxHeight = g.bitmap.height;
  }

  // Detect if font is missing lowercase letters (a-z) but has uppercase (A-Z)
  let hasUpper = 0, hasLower = 0;
  for (let cp = 65; cp <= 90; cp++) { if (glyphs.has(cp)) hasUpper++; }
  for (let cp = 97; cp <= 122; cp++) { if (glyphs.has(cp)) hasLower++; }
  const uppercaseOnly = hasUpper > 0 && hasLower === 0;

  // Compute glyph size metrics for display
  const advances = new Set();
  for (const g of manifest.glyphs) {
    if (g.codepoint >= 33) advances.add(g.advance); // skip space
  }
  const isMonospaced = advances.size === 1;
  const glyphWidth = isMonospaced ? [...advances][0] : 0;
  const glyphHeight = maxTop + (maxHeight > maxTop ? maxHeight - maxTop : 0) || maxTop + 2;

  return {
    id: manifest.font.id,
    family: manifest.font.family,
    ppem: manifest.font.ppem,
    sizeHint: manifest.font.sizeHint || null,
    glyphs,
    maxTop,
    maxHeight,
    uppercaseOnly,
    isMonospaced,
    glyphWidth,
    glyphHeight,
  };
}

/**
 * Load all available bitmap fonts.
 * Returns Map<id, Font>
 */
export async function loadAllFonts() {
  const results = await Promise.allSettled(
    FONT_MANIFEST_FILES.map(url => loadBitmapFont(url))
  );
  const fonts = new Map();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      fonts.set(r.value.id, r.value);
    }
  }
  return fonts;
}

/**
 * Draw a single glyph's bitmap pixels.
 * setPixel(x, y, color) is called for each filled pixel.
 * penX/baselineY are the pen position (baseline-relative).
 * Returns the glyph's advance width.
 */
export function drawGlyph(setPixel, glyph, penX, baselineY, color) {
  const x0 = penX + glyph.bitmap.left;
  const y0 = baselineY - glyph.bitmap.top;
  const rows = glyph.bitmap.rows;

  for (let row = 0; row < rows.length; row++) {
    const bits = rows[row];
    for (let col = 0; col < bits.length; col++) {
      if (bits[col] === '1') {
        setPixel(x0 + col, y0 + row, color);
      }
    }
  }

  return glyph.advance;
}

/**
 * Resolve a glyph for a codepoint, remapping lowercase to uppercase
 * if the font only has uppercase letters.
 */
function resolveGlyph(font, codepoint) {
  let glyph = font.glyphs.get(codepoint);
  if (!glyph && font.uppercaseOnly && codepoint >= 97 && codepoint <= 122) {
    glyph = font.glyphs.get(codepoint - 32);
  }
  return glyph || null;
}

/**
 * Draw a text string using a bitmap font.
 * startX, startY = top-left corner of text bounding box.
 * Internally converts to baseline coordinates using font.maxTop.
 */
export function drawText(setPixel, font, text, startX, startY, color) {
  const baselineY = startY + font.maxTop;
  let penX = startX;

  for (const char of text) {
    const codepoint = char.codePointAt(0);
    const glyph = resolveGlyph(font, codepoint);
    if (!glyph) continue;
    penX += drawGlyph(setPixel, glyph, penX, baselineY, color);
  }

  return penX;
}

/**
 * Measure the pixel dimensions of a text string in a given font.
 * Returns { width, height } where height is the font's maxTop + descent coverage.
 */
export function measureText(font, text) {
  let penX = 0;
  let minY = 0;
  let maxY = 0;

  for (const char of text) {
    const codepoint = char.codePointAt(0);
    const glyph = resolveGlyph(font, codepoint);
    if (!glyph) continue;

    const y0 = font.maxTop - glyph.bitmap.top;
    const y1 = y0 + glyph.bitmap.height;
    if (y0 < minY) minY = y0;
    if (y1 > maxY) maxY = y1;

    penX += glyph.advance;
  }

  return {
    width: penX,
    height: maxY - minY || font.maxTop + 2,
    minY,
    maxY,
  };
}

/**
 * Collect pixel positions for a text string (for preview rendering).
 * Returns an array of { x, y } objects for each filled pixel.
 */
export function getTextPixels(font, text, startX, startY) {
  const pixels = [];
  drawText(
    (x, y) => pixels.push({ x, y }),
    font, text, startX, startY, 1
  );
  return pixels;
}
