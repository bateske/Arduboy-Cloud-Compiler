/**
 * bitmap-detector.js
 * Detects, decodes, and re-encodes Arduboy bitmap arrays in C/C++ source code.
 * Provides Monaco CodeLens integration for inline bitmap editing.
 *
 * Exposes window.BitmapDetector with sub-modules: Parser, Codec, Engine, and
 * provideCodeLenses / registerCommands for Monaco integration.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  //  Format constants (mirror webtools OUTPUT_FORMAT)
  // ═══════════════════════════════════════════════════════════════════════════

  var FORMAT = {
    DRAW_BITMAP:       'drawBitmap',
    DRAW_SLOW_XY:      'drawSlowXYBitmap',
    SPRITES_OVERWRITE: 'spritesOverwrite',
    SPRITES_EXT_MASK:  'spritesExternalMask',
    SPRITES_PLUS_MASK: 'spritesPlusMask',
  };

  var FORMAT_LABELS = {};
  FORMAT_LABELS[FORMAT.DRAW_BITMAP]       = 'drawBitmap';
  FORMAT_LABELS[FORMAT.DRAW_SLOW_XY]      = 'drawSlowXYBitmap';
  FORMAT_LABELS[FORMAT.SPRITES_OVERWRITE] = 'Sprite';
  FORMAT_LABELS[FORMAT.SPRITES_EXT_MASK]  = 'Sprite ExtMask';
  FORMAT_LABELS[FORMAT.SPRITES_PLUS_MASK] = 'Sprite PlusMask';

  // ═══════════════════════════════════════════════════════════════════════════
  //  Parser — extract PROGMEM array declarations from source text
  // ═══════════════════════════════════════════════════════════════════════════

  var Parser = {};

  /**
   * Parse all candidate uint8_t / unsigned char arrays from source text.
   * Returns ArrayInfo[] with bytes, source ranges, and metadata.
   */
  Parser.parseArrays = function (sourceText) {
    var results = [];
    var lines = sourceText.split('\n');

    // Regex matches: optional const, uint8_t or unsigned char, optional PROGMEM
    // before or after name, name, [], =, {
    // We use a line-by-line approach for reliable range tracking.
    for (var i = 0; i < lines.length; i++) {
      // Skip blank lines so they never become the start of a joined match
      if (lines[i].trim() === '') continue;

      var joined = lines[i];
      // Sometimes the declaration spans multiple lines (e.g. "const uint8_t PROGMEM\n  name[] = {")
      // Peek ahead up to 3 lines to catch multi-line declarations
      var peekEnd = Math.min(i + 3, lines.length);
      for (var p = i + 1; p < peekEnd; p++) {
        if (/[{;]/.test(joined)) break;
        joined += ' ' + lines[p].trim();
      }

      var declMatch = joined.match(
        /^(\s*(?:const\s+)?(?:static\s+)?(?:uint8_t|unsigned\s+char|char)\s+(?:PROGMEM\s+)?(\w+)\s*\[\s*(?:\d*)\s*\]\s*(?:PROGMEM\s*)?=\s*)\{/
      );
      if (!declMatch) {
        // Also try PROGMEM before type (e.g. "const PROGMEM uint8_t name[]")
        declMatch = joined.match(
          /^(\s*(?:const\s+)?(?:static\s+)?PROGMEM\s+(?:uint8_t|unsigned\s+char|char)\s+(\w+)\s*\[\s*(?:\d*)\s*\]\s*=\s*)\{/
        );
      }
      if (!declMatch) {
        // Class-qualified: "const PROGMEM uint8_t ClassName::name[] = {"
        declMatch = joined.match(
          /^(\s*(?:const\s+)?(?:static\s+)?(?:PROGMEM\s+)?(?:uint8_t|unsigned\s+char|char)\s+(?:PROGMEM\s+)?(?:\w+::)?(\w+)\s*\[\s*(?:\d*)\s*\]\s*(?:PROGMEM\s*)?=\s*)\{/
        );
      }
      if (!declMatch) continue;

      var qualifiers = declMatch[1].replace(/\s+$/, '');
      var name = declMatch[2];
      var declLine = i + 1; // 1-based

      // Find the opening brace on the actual source line
      var braceLineIdx = i;
      while (braceLineIdx < lines.length && lines[braceLineIdx].indexOf('{') === -1) {
        braceLineIdx++;
      }
      if (braceLineIdx >= lines.length) continue;

      // Find closing '};'
      var braceDepth = 0;
      var endLineIdx = braceLineIdx;
      var foundClose = false;
      for (var j = braceLineIdx; j < lines.length; j++) {
        var line = lines[j];
        for (var c = 0; c < line.length; c++) {
          if (line[c] === '{') braceDepth++;
          else if (line[c] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              endLineIdx = j;
              foundClose = true;
              break;
            }
          }
        }
        if (foundClose) break;
      }
      if (!foundClose) continue;

      // Extract bytes from the array body (between { and })
      var bodyLines = lines.slice(braceLineIdx, endLineIdx + 1);
      var bodyText = bodyLines.join('\n');
      // Remove the opening qualifier+{ and closing };
      var openIdx = bodyText.indexOf('{');
      var closeIdx = bodyText.lastIndexOf('}');
      var innerText = bodyText.substring(openIdx + 1, closeIdx);

      var parseResult = Parser._parseBytes(innerText);
      if (parseResult.bytes.length === 0) { continue; }

      // Collect comment lines immediately preceding the declaration
      var commentHeader = null;
      var commentStartLine = declLine;
      var commentLines = [];
      for (var cl = i - 1; cl >= 0; cl--) {
        var trimmed = lines[cl].trim();
        if (trimmed === '') { break; } // blank line stops comment collection
        if (trimmed.indexOf('//') === 0 || trimmed.indexOf('/*') !== -1 || trimmed.indexOf('*') === 0) {
          commentLines.unshift(lines[cl]);
          commentStartLine = cl + 1; // 1-based
        } else {
          break;
        }
      }
      if (commentLines.length > 0) {
        commentHeader = commentLines.join('\n');
      }

      // Detect hex style
      var hexStyle = 'lower';
      var hexCheck = innerText.match(/0[xX][0-9a-fA-F]/);
      if (hexCheck && hexCheck[0][1] === 'X') hexStyle = 'upper';
      else if (hexCheck) {
        // Check if hex digits use uppercase
        var hexDigits = innerText.match(/0x([0-9a-fA-F]+)/);
        if (hexDigits && hexDigits[1] !== hexDigits[1].toLowerCase()) hexStyle = 'upper';
      }

      // Detect values per line
      var valuesPerLine = 12; // default
      for (var vl = braceLineIdx + 1; vl <= endLineIdx; vl++) {
        var vlLine = lines[vl].trim();
        if (vlLine.indexOf('//') === 0 || vlLine === '' || vlLine === '};') continue;
        var vlMatches = vlLine.match(/0[xXbB][0-9a-fA-F]+|\d+/g);
        if (vlMatches && vlMatches.length > 2) {
          // Found a real data line (not the 2-value width/height header)
          valuesPerLine = vlMatches.length;
          break;
        }
      }

      // Detect indentation
      var indent = '  ';
      for (var il = braceLineIdx + 1; il <= endLineIdx; il++) {
        var ilMatch = lines[il].match(/^(\s+)0/);
        if (ilMatch) { indent = ilMatch[1]; break; }
      }

      results.push({
        name: name,
        qualifiers: qualifiers,
        bytes: parseResult.bytes,
        hexStyle: hexStyle,
        valuesPerLine: valuesPerLine,
        indent: indent,
        startLine: commentStartLine,
        endLine: endLineIdx + 1, // 1-based
        commentHeader: commentHeader,
        declLine: declLine,
        arrayBodyStart: braceLineIdx + 1, // 1-based
        arrayBodyEnd: endLineIdx + 1, // 1-based
        frameComments: parseResult.frameComments,
      });

      // Skip past this array
      i = endLineIdx;
    }

    return results;
  };

  /**
   * Parse byte values from array body text. Handles hex, decimal, binary.
   * Skips single-line and block comments but records frame comment positions.
   * Returns { bytes: number[], frameComments: number[] } where frameComments
   * are byte indices where // Frame N comments appeared.
   */
  Parser._parseBytes = function (text) {
    var bytes = [];
    var frameComments = [];
    var i = 0;
    var len = text.length;

    while (i < len) {
      // Skip whitespace
      if (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r' || text[i] === ',') {
        i++;
        continue;
      }
      // Single-line comment
      if (text[i] === '/' && i + 1 < len && text[i + 1] === '/') {
        var eol = text.indexOf('\n', i);
        var commentText = text.substring(i, eol === -1 ? len : eol);
        // Check for frame comment
        var frameMatch = commentText.match(/\/\/\s*[Ff]rame\s+(\d+)/);
        if (frameMatch) {
          frameComments.push(bytes.length);
        }
        i = eol === -1 ? len : eol + 1;
        continue;
      }
      // Block comment
      if (text[i] === '/' && i + 1 < len && text[i + 1] === '*') {
        var endBlock = text.indexOf('*/', i + 2);
        i = endBlock === -1 ? len : endBlock + 2;
        continue;
      }
      // Hex literal
      if (text[i] === '0' && i + 1 < len && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
        var hexStart = i + 2;
        var hexEnd = hexStart;
        while (hexEnd < len && /[0-9a-fA-F]/.test(text[hexEnd])) hexEnd++;
        var val = parseInt(text.substring(hexStart, hexEnd), 16);
        if (!isNaN(val) && val >= 0 && val <= 255) bytes.push(val);
        i = hexEnd;
        continue;
      }
      // Binary literal
      if (text[i] === '0' && i + 1 < len && (text[i + 1] === 'b' || text[i + 1] === 'B')) {
        var binStart = i + 2;
        var binEnd = binStart;
        while (binEnd < len && (text[binEnd] === '0' || text[binEnd] === '1')) binEnd++;
        var bval = parseInt(text.substring(binStart, binEnd), 2);
        if (!isNaN(bval) && bval >= 0 && bval <= 255) bytes.push(bval);
        i = binEnd;
        continue;
      }
      // Decimal literal
      if (text[i] >= '0' && text[i] <= '9') {
        var decStart = i;
        var decEnd = decStart;
        while (decEnd < len && text[decEnd] >= '0' && text[decEnd] <= '9') decEnd++;
        var dval = parseInt(text.substring(decStart, decEnd), 10);
        if (!isNaN(dval) && dval >= 0 && dval <= 255) bytes.push(dval);
        i = decEnd;
        continue;
      }
      // Skip any other character (identifiers used as values like WIDTH, HEIGHT)
      // These reference constants — we include them as-is if they look like dimension headers
      i++;
    }

    return { bytes: bytes, frameComments: frameComments };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Codec — bidirectional byte ↔ ImageData conversion
  // ═══════════════════════════════════════════════════════════════════════════

  var Codec = {};

  /**
   * Decode vertical-byte-column data to ImageData.
   * LSB = top pixel of each 8-pixel column strip.
   * maskBytes optional: where mask bit 0 → transparent.
   */
  Codec.unpackVertical = function (imageBytes, width, paddedHeight, maskBytes) {
    var imgData = new ImageData(width, paddedHeight);
    var dst = imgData.data;

    var byteIdx = 0;
    for (var yStrip = 0; yStrip < paddedHeight; yStrip += 8) {
      for (var x = 0; x < width; x++) {
        var imgByte = imageBytes[byteIdx] || 0;
        var maskByte = maskBytes ? (maskBytes[byteIdx] || 0) : 0xFF;
        for (var bit = 0; bit < 8; bit++) {
          var y = yStrip + bit;
          if (y >= paddedHeight) break;
          var pixIdx = (y * width + x) * 4;
          var isWhite = (imgByte >> bit) & 1;
          var isOpaque = (maskByte >> bit) & 1;

          if (maskBytes && !isOpaque) {
            // Transparent
            dst[pixIdx] = 0; dst[pixIdx + 1] = 0; dst[pixIdx + 2] = 0; dst[pixIdx + 3] = 0;
          } else if (isWhite) {
            dst[pixIdx] = 255; dst[pixIdx + 1] = 255; dst[pixIdx + 2] = 255; dst[pixIdx + 3] = 255;
          } else {
            dst[pixIdx] = 0; dst[pixIdx + 1] = 0; dst[pixIdx + 2] = 0; dst[pixIdx + 3] = 255;
          }
        }
        byteIdx++;
      }
    }

    return imgData;
  };

  /**
   * Decode horizontal-byte-row data to ImageData.
   * MSB (bit 7) = leftmost pixel.
   */
  Codec.unpackHorizontal = function (imageBytes, width, height) {
    var imgData = new ImageData(width, height);
    var dst = imgData.data;
    var bytesPerRow = Math.ceil(width / 8);
    var byteIdx = 0;

    for (var y = 0; y < height; y++) {
      for (var byteCol = 0; byteCol < bytesPerRow; byteCol++) {
        var b = imageBytes[byteIdx++] || 0;
        for (var bit = 0; bit < 8; bit++) {
          var x = byteCol * 8 + bit;
          if (x >= width) break;
          var pixIdx = (y * width + x) * 4;
          var isWhite = (b >> (7 - bit)) & 1;
          if (isWhite) {
            dst[pixIdx] = 255; dst[pixIdx + 1] = 255; dst[pixIdx + 2] = 255; dst[pixIdx + 3] = 255;
          } else {
            dst[pixIdx] = 0; dst[pixIdx + 1] = 0; dst[pixIdx + 2] = 0; dst[pixIdx + 3] = 255;
          }
        }
      }
    }

    return imgData;
  };

  /**
   * De-interleave plus-mask data: [img0, mask0, img1, mask1, ...] → {imageBytes, maskBytes}
   */
  Codec.deinterleavePlusMask = function (bytes) {
    var imageBytes = [];
    var maskBytes = [];
    for (var i = 0; i < bytes.length; i += 2) {
      imageBytes.push(bytes[i]);
      maskBytes.push(i + 1 < bytes.length ? bytes[i + 1] : 0xFF);
    }
    return { imageBytes: imageBytes, maskBytes: maskBytes };
  };

  /**
   * Interleave image and mask bytes: → [img0, mask0, img1, mask1, ...]
   */
  Codec.interleavePlusMask = function (imageBytes, maskBytes) {
    var result = [];
    for (var i = 0; i < imageBytes.length; i++) {
      result.push(imageBytes[i]);
      result.push(i < maskBytes.length ? maskBytes[i] : 0xFF);
    }
    return result;
  };

  /**
   * Encode ImageData → vertical-byte-column format.
   * Inverse of unpackVertical. Returns { imageBytes, maskBytes }.
   */
  Codec.packVertical = function (imgData, width, paddedHeight) {
    var pixels = imgData.data;
    var imgWidth = imgData.width;
    var imgHeight = imgData.height;
    var imageBytes = [];
    var maskBytes = [];

    for (var yStrip = 0; yStrip < paddedHeight; yStrip += 8) {
      for (var x = 0; x < width; x++) {
        var imgByte = 0;
        var maskByte = 0;
        for (var bit = 0; bit < 8; bit++) {
          var srcY = yStrip + bit;
          if (x < imgWidth && srcY < imgHeight) {
            var idx = (srcY * imgWidth + x) * 4;
            var brightness = pixels[idx + 1]; // green channel
            var alpha = pixels[idx + 3];
            if (brightness > 128) {
              imgByte |= 1 << bit;
            }
            if (alpha > 128) {
              maskByte |= 1 << bit;
            }
          }
        }
        imageBytes.push(imgByte);
        maskBytes.push(maskByte);
      }
    }

    return { imageBytes: imageBytes, maskBytes: maskBytes };
  };

  /**
   * Encode ImageData → horizontal-byte-row format.
   * Inverse of unpackHorizontal. Returns number[].
   */
  Codec.packHorizontal = function (imgData, width, height) {
    var pixels = imgData.data;
    var imgWidth = imgData.width;
    var imgHeight = imgData.height;
    var bytes = [];
    var bytesPerRow = Math.ceil(width / 8);

    for (var y = 0; y < height; y++) {
      for (var byteCol = 0; byteCol < bytesPerRow; byteCol++) {
        var b = 0;
        for (var bit = 0; bit < 8; bit++) {
          var px = byteCol * 8 + bit;
          if (px < width && px < imgWidth && y < imgHeight) {
            var idx = (y * imgWidth + px) * 4;
            var brightness = pixels[idx + 1];
            if (brightness > 128) {
              b |= 1 << (7 - bit);
            }
          }
        }
        bytes.push(b);
      }
    }

    return bytes;
  };

  /**
   * High-level decode: given detection result and array info, produce ImageData.
   * Handles all 5 formats: extracts header bytes for Sprites formats,
   * de-interleaves plus-mask, etc.
   */
  Codec.decode = function (arrayInfo, detection) {
    var bytes = arrayInfo.bytes;
    var format = detection.format;
    var w = detection.width;
    var h = detection.height;
    var frameCount = detection.frameCount || 1;
    var paddedH = Math.ceil(h / 8) * 8;

    switch (format) {
      case FORMAT.DRAW_BITMAP: {
        // No header. Vertical format.
        var pixelsPerFrame = w * (paddedH / 8);
        // Tile frames side-by-side for multi-frame
        var totalW = w * frameCount;
        var imgData = new ImageData(totalW, paddedH);
        for (var f = 0; f < frameCount; f++) {
          var frameBytes = bytes.slice(f * pixelsPerFrame, (f + 1) * pixelsPerFrame);
          var frameImg = Codec.unpackVertical(frameBytes, w, paddedH);
          Codec._blitFrame(imgData, frameImg, f * w, 0);
        }
        return imgData;
      }

      case FORMAT.DRAW_SLOW_XY: {
        // No header. Horizontal format.
        var bpr = Math.ceil(w / 8);
        var bytesPerFrame = bpr * h;
        var totalW2 = w * frameCount;
        var imgData2 = new ImageData(totalW2, h);
        for (var f2 = 0; f2 < frameCount; f2++) {
          var fb = bytes.slice(f2 * bytesPerFrame, (f2 + 1) * bytesPerFrame);
          var fi = Codec.unpackHorizontal(fb, w, h);
          Codec._blitFrame(imgData2, fi, f2 * w, 0);
        }
        return imgData2;
      }

      case FORMAT.SPRITES_OVERWRITE: {
        // [w, h] header, then data. Vertical format.
        var dataBytes = bytes.slice(2);
        var bytesPerFrame3 = w * (paddedH / 8);
        var totalW3 = w * frameCount;
        var imgData3 = new ImageData(totalW3, paddedH);
        for (var f3 = 0; f3 < frameCount; f3++) {
          var fb3 = dataBytes.slice(f3 * bytesPerFrame3, (f3 + 1) * bytesPerFrame3);
          var fi3 = Codec.unpackVertical(fb3, w, paddedH);
          Codec._blitFrame(imgData3, fi3, f3 * w, 0);
        }
        return imgData3;
      }

      case FORMAT.SPRITES_EXT_MASK: {
        // Image: [w, h] + data. Mask: separate array (no header).
        var imgBytes = bytes.slice(2);
        var bytesPerFrame4 = w * (paddedH / 8);
        var maskArr = detection.maskArrayInfo;
        var maskBytesAll = maskArr ? maskArr.bytes : null;
        var totalW4 = w * frameCount;
        var imgData4 = new ImageData(totalW4, paddedH);
        for (var f4 = 0; f4 < frameCount; f4++) {
          var fi4 = imgBytes.slice(f4 * bytesPerFrame4, (f4 + 1) * bytesPerFrame4);
          var mi4 = maskBytesAll ? maskBytesAll.slice(f4 * bytesPerFrame4, (f4 + 1) * bytesPerFrame4) : null;
          var img4 = Codec.unpackVertical(fi4, w, paddedH, mi4);
          Codec._blitFrame(imgData4, img4, f4 * w, 0);
        }
        return imgData4;
      }

      case FORMAT.SPRITES_PLUS_MASK: {
        // [w, h] header, then interleaved [img, mask] pairs. Vertical format.
        var interleavedBytes = bytes.slice(2);
        var bytesPerFrame5 = w * (paddedH / 8); // per channel
        var totalW5 = w * frameCount;
        var imgData5 = new ImageData(totalW5, paddedH);
        for (var f5 = 0; f5 < frameCount; f5++) {
          var chunk = interleavedBytes.slice(f5 * bytesPerFrame5 * 2, (f5 + 1) * bytesPerFrame5 * 2);
          var separated = Codec.deinterleavePlusMask(chunk);
          var img5 = Codec.unpackVertical(separated.imageBytes, w, paddedH, separated.maskBytes);
          Codec._blitFrame(imgData5, img5, f5 * w, 0);
        }
        return imgData5;
      }
    }

    return null;
  };

  /**
   * High-level encode: given ImageData and detection info, produce bytes + code.
   * Returns { bytes, maskBytes, code } for replacement.
   */
  Codec.encode = function (imgData, arrayInfo, detection) {
    var format = detection.format;
    var w = detection.width;
    var h = detection.height;
    var frameCount = detection.frameCount || 1;
    var paddedH = Math.ceil(h / 8) * 8;
    var isHorizontal = format === FORMAT.DRAW_SLOW_XY;

    var allImageBytes = [];
    var allMaskBytes = [];

    for (var f = 0; f < frameCount; f++) {
      // Extract frame from tiled image
      var frameImg = Codec._extractFrame(imgData, f * w, 0, w, isHorizontal ? h : paddedH);

      if (isHorizontal) {
        var hb = Codec.packHorizontal(frameImg, w, h);
        allImageBytes = allImageBytes.concat(hb);
      } else {
        var packed = Codec.packVertical(frameImg, w, paddedH);
        allImageBytes = allImageBytes.concat(packed.imageBytes);
        allMaskBytes = allMaskBytes.concat(packed.maskBytes);
      }
    }

    return {
      imageBytes: allImageBytes,
      maskBytes: allMaskBytes,
    };
  };

  /**
   * Generate replacement source code for the array, preserving style.
   */
  Codec.generateReplacementCode = function (arrayInfo, detection, imageBytes, maskBytes) {
    var name = arrayInfo.name;
    var format = detection.format;
    var w = detection.width;
    var h = detection.height;
    var frameCount = detection.frameCount || 1;
    var paddedH = Math.ceil(h / 8) * 8;
    var style = {
      hexStyle: arrayInfo.hexStyle,
      valuesPerLine: arrayInfo.valuesPerLine,
      indent: arrayInfo.indent,
      qualifiers: arrayInfo.qualifiers,
    };

    var lines = [];

    // Comment header
    var displayH = (format === FORMAT.DRAW_SLOW_XY) ? h : paddedH;
    switch (format) {
      case FORMAT.DRAW_BITMAP:
        lines.push('// ' + w + 'x' + displayH + ', ' + frameCount + ' frame(s), ' + imageBytes.length + ' bytes');
        lines.push('// Example: Arduboy2Base::drawBitmap(x, y, ' + name + ', ' + w + ', ' + displayH + ', WHITE);');
        break;
      case FORMAT.DRAW_SLOW_XY:
        lines.push('// ' + w + 'x' + displayH + ', ' + frameCount + ' frame(s), ' + imageBytes.length + ' bytes');
        lines.push('// Example: Arduboy2Base::drawSlowXYBitmap(x, y, ' + name + ', ' + w + ', ' + displayH + ', WHITE);');
        break;
      case FORMAT.SPRITES_OVERWRITE:
        lines.push('// ' + w + 'x' + displayH + ', ' + frameCount + ' frame(s), ' + (imageBytes.length + 2) + ' bytes');
        lines.push('// Example: Sprites::drawOverwrite(x, y, ' + name + ', frame);');
        break;
      case FORMAT.SPRITES_EXT_MASK:
        lines.push('// ' + w + 'x' + displayH + ', ' + frameCount + ' frame(s)');
        lines.push('// Image: ' + (imageBytes.length + 2) + ' bytes, Mask: ' + maskBytes.length + ' bytes');
        lines.push('// Example: Sprites::drawExternalMask(x, y, ' + name + ', ' + name + 'Mask, frame, 0);');
        break;
      case FORMAT.SPRITES_PLUS_MASK:
        lines.push('// ' + w + 'x' + displayH + ', ' + frameCount + ' frame(s), ' + (imageBytes.length * 2 + 2) + ' bytes');
        lines.push('// Example: Sprites::drawPlusMask(x, y, ' + name + ', frame);');
        break;
    }

    // Array declaration
    lines.push(style.qualifiers + ' {');

    // Header bytes for Sprites formats
    if (format === FORMAT.SPRITES_OVERWRITE || format === FORMAT.SPRITES_EXT_MASK || format === FORMAT.SPRITES_PLUS_MASK) {
      lines.push(style.indent + w + ', ' + paddedH + ',');
    }

    // Byte data
    var bytesPerFrame = imageBytes.length / frameCount;
    for (var f = 0; f < frameCount; f++) {
      if (frameCount > 1) lines.push(style.indent + '// Frame ' + f);

      var frameImageBytes = imageBytes.slice(f * bytesPerFrame, (f + 1) * bytesPerFrame);

      if (format === FORMAT.SPRITES_PLUS_MASK) {
        var frameMaskBytes = maskBytes.slice(f * bytesPerFrame, (f + 1) * bytesPerFrame);
        var interleaved = Codec.interleavePlusMask(frameImageBytes, frameMaskBytes);
        lines.push.apply(lines, Codec._formatHexLines(interleaved, style));
      } else {
        lines.push.apply(lines, Codec._formatHexLines(frameImageBytes, style));
      }
    }

    lines.push('};');

    // External mask array
    if (format === FORMAT.SPRITES_EXT_MASK && maskBytes.length > 0) {
      lines.push('');
      var maskName = name + 'Mask';
      var maskQualifiers = style.qualifiers.replace(name, maskName);
      // If qualifiers don't contain the name (class-qualified), reconstruct
      if (maskQualifiers === style.qualifiers) {
        maskQualifiers = style.qualifiers.replace(/\w+(\s*\[)/, maskName + '$1');
      }
      lines.push(maskQualifiers + ' {');
      var maskBytesPerFrame = maskBytes.length / frameCount;
      for (var mf = 0; mf < frameCount; mf++) {
        if (frameCount > 1) lines.push(style.indent + '// Frame ' + mf);
        var frameMask = maskBytes.slice(mf * maskBytesPerFrame, (mf + 1) * maskBytesPerFrame);
        lines.push.apply(lines, Codec._formatHexLines(frameMask, style));
      }
      lines.push('};');
    }

    return lines.join('\n');
  };

  /** Format bytes as hex lines with given style. */
  Codec._formatHexLines = function (bytes, style) {
    var lines = [];
    var perLine = style.valuesPerLine || 12;
    var indent = style.indent || '  ';
    var upper = style.hexStyle === 'upper';

    for (var i = 0; i < bytes.length; i += perLine) {
      var chunk = bytes.slice(i, i + perLine);
      var hex = [];
      for (var j = 0; j < chunk.length; j++) {
        var s = chunk[j].toString(16).padStart(2, '0');
        hex.push('0x' + (upper ? s.toUpperCase() : s));
      }
      lines.push(indent + hex.join(', ') + ',');
    }
    return lines;
  };

  /** Blit a frame ImageData onto a target ImageData at offset. */
  Codec._blitFrame = function (target, frame, offsetX, offsetY) {
    var tw = target.width;
    var fw = frame.width;
    var fh = frame.height;
    var td = target.data;
    var fd = frame.data;
    for (var y = 0; y < fh; y++) {
      for (var x = 0; x < fw; x++) {
        var si = (y * fw + x) * 4;
        var di = ((y + offsetY) * tw + (x + offsetX)) * 4;
        td[di] = fd[si]; td[di + 1] = fd[si + 1]; td[di + 2] = fd[si + 2]; td[di + 3] = fd[si + 3];
      }
    }
  };

  /** Extract a sub-region from ImageData as a new ImageData. */
  Codec._extractFrame = function (imgData, sx, sy, w, h) {
    var frame = new ImageData(w, h);
    var sd = imgData.data;
    var dd = frame.data;
    var sw = imgData.width;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var si = ((sy + y) * sw + (sx + x)) * 4;
        var di = (y * w + x) * 4;
        dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
      }
    }
    return frame;
  };


  // ═══════════════════════════════════════════════════════════════════════════
  //  Engine — format detection, confidence scoring, draw call scanning
  // ═══════════════════════════════════════════════════════════════════════════

  var Engine = {};

  /**
   * Scan all source text for draw calls referencing bitmap variables.
   * Returns Map-like object: { varName: [DrawCallInfo, ...] }
   */
  Engine.scanDrawCalls = function (sourceText) {
    var calls = {};

    var patterns = [
      // drawBitmap(x, y, name, width, height, color)
      { re: /(?:arduboy|Arduboy2Base)\s*[\.\:]+\s*drawBitmap\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)\s*,\s*(\w+|\d+)\s*,\s*(\w+|\d+)/g,
        format: FORMAT.DRAW_BITMAP, hasWH: true },
      // drawSlowXYBitmap(x, y, name, width, height, color)
      { re: /(?:arduboy|Arduboy2Base)\s*[\.\:]+\s*drawSlowXYBitmap\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)\s*,\s*(\w+|\d+)\s*,\s*(\w+|\d+)/g,
        format: FORMAT.DRAW_SLOW_XY, hasWH: true },
      // drawCompressed(x, y, name, ...) — detect but not editable
      { re: /(?:arduboy|Arduboy2Base)\s*[\.\:]+\s*drawCompressed\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)/g,
        format: 'compressed', hasWH: false },
      // Sprites::drawOverwrite(x, y, name, frame) — also drawSelfMasked, drawErase
      { re: /(?:Sprites|SpritesB|sprites?)\s*[\.\:]+\s*draw(?:Overwrite|SelfMasked|Erase)\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)/g,
        format: FORMAT.SPRITES_OVERWRITE, hasWH: false },
      // Sprites::drawPlusMask(x, y, name, frame)
      { re: /(?:Sprites|SpritesB|sprites?)\s*[\.\:]+\s*drawPlusMask\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)/g,
        format: FORMAT.SPRITES_PLUS_MASK, hasWH: false },
      // Sprites::drawExternalMask(x, y, name, maskName, frame, maskFrame)
      { re: /(?:Sprites|SpritesB|sprites?)\s*[\.\:]+\s*drawExternalMask\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)\s*,\s*(\w+)/g,
        format: FORMAT.SPRITES_EXT_MASK, hasWH: false, hasMask: true },
      // ArdBitmap drawCompressed — detect but not editable
      { re: /(?:ardbitmap|ArdBitmap)\s*[\.\<][^>]*>\s*\.?\s*drawCompressed\s*\(\s*[^,]+,\s*[^,]+,\s*(\w+)/g,
        format: 'ardbitmap_compressed', hasWH: false },
    ];

    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      var match;
      pat.re.lastIndex = 0;
      while ((match = pat.re.exec(sourceText)) !== null) {
        var varName = match[1];
        if (!calls[varName]) calls[varName] = [];
        var info = { format: pat.format, varName: varName };
        if (pat.hasWH && match[2] && match[3]) {
          var pw = parseInt(match[2], 10);
          var ph = parseInt(match[3], 10);
          if (!isNaN(pw)) info.width = pw;
          if (!isNaN(ph)) info.height = ph;
        }
        if (pat.hasMask && match[2]) {
          info.maskName = match[2];
        }
        calls[varName].push(info);
      }
    }

    return calls;
  };

  /**
   * Scan source for nearby width/height constants matching a variable name.
   * Looks for patterns like: constexpr uint8_t nameWidth = N;
   *                          #define NAME_WIDTH N
   */
  Engine.scanDimensionConstants = function (sourceText, name) {
    var result = { width: null, height: null };

    // camelCase: nameWidth, nameHeight
    var camelW = new RegExp('(?:constexpr|const)\\s+(?:uint8_t|uint16_t|int)\\s+' + Engine._escapeRegex(name) + 'Width\\s*=\\s*(\\d+)', 'i');
    var camelH = new RegExp('(?:constexpr|const)\\s+(?:uint8_t|uint16_t|int)\\s+' + Engine._escapeRegex(name) + 'Height\\s*=\\s*(\\d+)', 'i');

    // snake_case: name_width, name_height
    var snakeW = new RegExp('(?:constexpr|const)\\s+(?:uint8_t|uint16_t|int)\\s+' + Engine._escapeRegex(name) + '_[Ww]idth\\s*=\\s*(\\d+)', 'i');
    var snakeH = new RegExp('(?:constexpr|const)\\s+(?:uint8_t|uint16_t|int)\\s+' + Engine._escapeRegex(name) + '_[Hh]eight\\s*=\\s*(\\d+)', 'i');

    // UPPER_CASE #define: NAME_WIDTH
    var upper = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    var defW = new RegExp('#define\\s+' + Engine._escapeRegex(upper) + '_WIDTH\\s+(\\d+)', 'i');
    var defH = new RegExp('#define\\s+' + Engine._escapeRegex(upper) + '_HEIGHT\\s+(\\d+)', 'i');

    var patterns = [
      [camelW, 'width'], [camelH, 'height'],
      [snakeW, 'width'], [snakeH, 'height'],
      [defW, 'width'], [defH, 'height'],
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = sourceText.match(patterns[i][0]);
      if (m) {
        var val = parseInt(m[1], 10);
        if (!isNaN(val) && val > 0 && val <= 256) {
          result[patterns[i][1]] = val;
        }
      }
    }

    return result;
  };

  /**
   * Analyze a parsed array to determine format, dimensions, and confidence.
   * allSourceTexts: array of {text, tabId} for cross-file draw call scanning.
   */
  Engine.analyzeArray = function (arrayInfo, sourceText, allSourceTexts) {
    var bytes = arrayInfo.bytes;
    var name = arrayInfo.name;
    var comment = arrayInfo.commentHeader || '';

    var result = {
      format: null,
      confidence: 0,
      width: null,
      height: null,
      frameCount: 1,
      hasMask: false,
      maskArrayName: null,
      maskArrayInfo: null,
      sources: [],
      dimensionCandidates: [],
      compressed: false,
    };

    if (bytes.length < 2) return result;

    // ── 1. Parse structured comments ────────────────────────────────────
    var commentDims = Engine._parseCommentDimensions(comment);
    if (commentDims.width && commentDims.height) {
      result.width = commentDims.width;
      result.height = commentDims.height;
      result.confidence += 40;
      result.sources.push('comment');
      if (commentDims.frameCount) result.frameCount = commentDims.frameCount;
    }

    // ── 2. Parse "Render with:" comment for format ──────────────────────
    var commentFormat = Engine._parseRenderWithComment(comment);
    if (commentFormat.format) {
      result.format = commentFormat.format;
      result.confidence += 30;
      result.sources.push('renderComment');
      if (commentFormat.format === FORMAT.SPRITES_EXT_MASK && commentFormat.maskName) {
        result.maskArrayName = commentFormat.maskName;
        result.hasMask = true;
      }
    }

    // Check for compressed format comments
    if (comment.indexOf('drawCompressed()') !== -1) {
      result.compressed = true;
      result.confidence += 30;
      result.sources.push('compressedComment');
    }

    // ── 3. Scan draw calls across all source texts ──────────────────────
    var texts = allSourceTexts || [{ text: sourceText }];
    for (var t = 0; t < texts.length; t++) {
      var calls = Engine.scanDrawCalls(texts[t].text);
      if (calls[name]) {
        var callList = calls[name];
        for (var ci = 0; ci < callList.length; ci++) {
          var call = callList[ci];

          // Compressed — mark and skip
          if (call.format === 'compressed' || call.format === 'ardbitmap_compressed') {
            result.compressed = true;
            result.confidence += 20;
            result.sources.push('compressedDrawCall');
            continue;
          }

          if (!result.format) {
            result.format = call.format;
            result.confidence += 20;
            result.sources.push('drawCall');
          }
          if (call.width && !result.width) result.width = call.width;
          if (call.height && !result.height) result.height = call.height;
          if (call.maskName) {
            result.maskArrayName = call.maskName;
            result.hasMask = true;
          }
        }
      }
    }

    // ── 4. Check embedded [w, h] header ─────────────────────────────────
    if (!result.compressed) {
      var headerResult = Engine._checkEmbeddedHeader(bytes, result.format);
      if (headerResult.valid) {
        if (!result.width) result.width = headerResult.width;
        if (!result.height) result.height = headerResult.height;
        if (!result.format) {
          result.format = headerResult.format;
        }
        if (headerResult.frameCount) result.frameCount = headerResult.frameCount;
        result.confidence += 25;
        result.sources.push('header');
      }
    }

    // ── 5. Scan dimension constants ─────────────────────────────────────
    var dimConsts = Engine.scanDimensionConstants(sourceText, name);
    if (dimConsts.width && !result.width) {
      result.width = dimConsts.width;
      result.confidence += 15;
      result.sources.push('constant');
    }
    if (dimConsts.height && !result.height) {
      result.height = dimConsts.height;
      if (result.sources.indexOf('constant') === -1) {
        result.confidence += 15;
        result.sources.push('constant');
      }
    }

    // Also check across all source texts for constants
    if ((!dimConsts.width || !dimConsts.height) && allSourceTexts) {
      for (var st = 0; st < allSourceTexts.length; st++) {
        var dc2 = Engine.scanDimensionConstants(allSourceTexts[st].text, name);
        if (dc2.width && !result.width) result.width = dc2.width;
        if (dc2.height && !result.height) result.height = dc2.height;
      }
    }

    // ── 6. Check "// width, height," comment in array body ──────────────
    if (!result.width || !result.height) {
      // Some arrays have "// width, height," followed by the dimension values
      // as the first two bytes (e.g. from HardwareTest examples)
      var bodyComment = Engine._checkWidthHeightComment(arrayInfo);
      if (bodyComment.width && bodyComment.height) {
        result.width = bodyComment.width;
        result.height = bodyComment.height;
        if (!result.format) {
          result.format = FORMAT.SPRITES_OVERWRITE; // has header → Sprites format
        }
        result.confidence += 25;
        result.sources.push('bodyComment');
      }
    }

    // ── 7. Name-based heuristics ────────────────────────────────────────
    var nameLower = name.toLowerCase();
    var bitmapKeywords = ['bitmap', 'sprite', 'mask', 'gfx', 'img', 'icon', 'logo', 'tile', 'font', 'image'];
    for (var k = 0; k < bitmapKeywords.length; k++) {
      if (nameLower.indexOf(bitmapKeywords[k]) !== -1) {
        result.confidence += 10;
        result.sources.push('name');
        break;
      }
    }

    // ── 8. Dimension consistency check ──────────────────────────────────
    if (result.width && result.height && !result.compressed) {
      var consistent = Engine._checkDimensionConsistency(bytes, result.width, result.height, result.format, result.frameCount);
      if (consistent.valid) {
        result.confidence += 5;
        result.sources.push('sizeConsistent');
        if (consistent.frameCount > result.frameCount) {
          result.frameCount = consistent.frameCount;
        }
      }
      // Consistency bonus when multiple sources agree
      if (result.sources.length >= 3) {
        result.confidence += 10;
      }
    }

    // ── 9. Compute frame count from data if not already set ──────────
    if (result.width && result.height && result.frameCount <= 1 && !result.compressed) {
      var fc = Engine._inferFrameCount(bytes, result.width, result.height, result.format);
      if (fc > 1) result.frameCount = fc;
    }

    // ── 10. Generate dimension candidates when ambiguous ────────────────
    if ((!result.width || !result.height) && !result.compressed) {
      result.dimensionCandidates = Engine._generateDimensionCandidates(bytes, result.format);
      // If we have candidates, bump confidence slightly
      if (result.dimensionCandidates.length > 0) {
        result.confidence += 5;
        // Use top candidate as fallback
        if (!result.width) result.width = result.dimensionCandidates[0].w;
        if (!result.height) result.height = result.dimensionCandidates[0].h;
      }
    }

    // ── 11. Default format if none detected ─────────────────────────────
    if (!result.format && !result.compressed && result.confidence >= 20) {
      // If bytes look like they have a header, assume Sprites
      if (bytes.length > 2 && bytes[0] > 0 && bytes[0] <= 128 && bytes[1] > 0 && bytes[1] <= 128 && bytes[1] % 8 === 0) {
        var testDataLen = bytes.length - 2;
        var testBPF = bytes[0] * (bytes[1] / 8);
        if (testDataLen > 0 && testDataLen % testBPF === 0) {
          result.format = FORMAT.SPRITES_OVERWRITE;
        }
      }
      if (!result.format) {
        result.format = FORMAT.DRAW_BITMAP;
      }
    }

    // Cap confidence at 100
    result.confidence = Math.min(result.confidence, 100);

    return result;
  };

  /** Parse "// WxH, N frame(s)" or "// WxH px (N bytes)" from comment. */
  Engine._parseCommentDimensions = function (comment) {
    var result = { width: null, height: null, frameCount: null };

    // Pattern: "// WxH, N frame(s), B bytes"
    var m = comment.match(/\/\/\s*(\d+)\s*x\s*(\d+)\s*(?:,\s*(\d+)\s*frame)?/i);
    if (m) {
      result.width = parseInt(m[1], 10);
      result.height = parseInt(m[2], 10);
      if (m[3]) result.frameCount = parseInt(m[3], 10);
      return result;
    }

    // Pattern: "// WxH px (N bytes)"
    m = comment.match(/\/\/\s*(\d+)\s*x\s*(\d+)\s*px/i);
    if (m) {
      result.width = parseInt(m[1], 10);
      result.height = parseInt(m[2], 10);
      return result;
    }

    // Pattern: "width: W height: H"
    m = comment.match(/width:\s*(\d+)\s+height:\s*(\d+)/i);
    if (m) {
      result.width = parseInt(m[1], 10);
      result.height = parseInt(m[2], 10);
      return result;
    }

    return result;
  };

  /** Parse "// Render with: ..." comment to detect format. */
  Engine._parseRenderWithComment = function (comment) {
    var result = { format: null, maskName: null };

    if (comment.indexOf('Sprites::drawPlusMask') !== -1 || comment.indexOf('Sprites::drawplusMask') !== -1) {
      result.format = FORMAT.SPRITES_PLUS_MASK;
    } else if (comment.indexOf('Sprites::drawExternalMask') !== -1) {
      result.format = FORMAT.SPRITES_EXT_MASK;
      var maskMatch = comment.match(/Sprites::drawExternalMask\s*\([^,]+,\s*[^,]+,\s*\w+\s*,\s*(\w+)/);
      if (maskMatch) result.maskName = maskMatch[1];
    } else if (/Sprites::draw(?:Overwrite|SelfMasked|Erase)/.test(comment)) {
      result.format = FORMAT.SPRITES_OVERWRITE;
    } else if (comment.indexOf('drawSlowXYBitmap') !== -1) {
      result.format = FORMAT.DRAW_SLOW_XY;
    } else if (comment.indexOf('drawBitmap') !== -1 && comment.indexOf('drawSlowXYBitmap') === -1) {
      result.format = FORMAT.DRAW_BITMAP;
    }

    return result;
  };

  /** Check if first two bytes form a valid Sprites [w, h] header. */
  Engine._checkEmbeddedHeader = function (bytes, knownFormat) {
    var result = { valid: false, width: null, height: null, format: null, frameCount: null };
    if (bytes.length < 4) return result;

    var w = bytes[0];
    var h = bytes[1];

    // Valid dimension ranges for Arduboy
    if (w < 1 || w > 128 || h < 1 || h > 128) return result;
    if (h % 8 !== 0) return result;

    var dataLen = bytes.length - 2;
    var bytesPerFrame = w * (h / 8);
    if (bytesPerFrame === 0) return result;

    // Check if data length is a valid multiple of frame size
    if (dataLen % bytesPerFrame === 0) {
      result.valid = true;
      result.width = w;
      result.height = h;
      result.frameCount = dataLen / bytesPerFrame;
      result.format = FORMAT.SPRITES_OVERWRITE;
      return result;
    }

    // Check for plus-mask (interleaved, double the data)
    if (dataLen % (bytesPerFrame * 2) === 0) {
      result.valid = true;
      result.width = w;
      result.height = h;
      result.frameCount = dataLen / (bytesPerFrame * 2);
      result.format = FORMAT.SPRITES_PLUS_MASK;
      return result;
    }

    return result;
  };

  /** Check for "// width, height," comment in body (HardwareTest convention). */
  Engine._checkWidthHeightComment = function (arrayInfo) {
    var result = { width: null, height: null };
    if (arrayInfo.bytes.length < 4) return result;

    // The first two bytes should be width and height
    var w = arrayInfo.bytes[0];
    var h = arrayInfo.bytes[1];
    if (w < 1 || w > 128 || h < 1 || h > 128 || h % 8 !== 0) return result;

    var dataLen = arrayInfo.bytes.length - 2;
    var bytesPerFrame = w * (h / 8);
    if (bytesPerFrame > 0 && dataLen > 0 && dataLen % bytesPerFrame === 0) {
      result.width = w;
      result.height = h;
    }

    return result;
  };

  /** Check if byte array size is consistent with claimed dimensions and format. */
  Engine._checkDimensionConsistency = function (bytes, w, h, format, frameCount) {
    var result = { valid: false, frameCount: frameCount || 1 };
    var paddedH = Math.ceil(h / 8) * 8;
    var dataBytes = bytes;
    var hasHeader = false;

    if (format === FORMAT.SPRITES_OVERWRITE || format === FORMAT.SPRITES_EXT_MASK || format === FORMAT.SPRITES_PLUS_MASK) {
      if (bytes.length > 2 && bytes[0] === w && bytes[1] === paddedH) {
        dataBytes = bytes.slice(2);
        hasHeader = true;
      }
    }

    var bytesPerFrame;
    if (format === FORMAT.DRAW_SLOW_XY) {
      bytesPerFrame = Math.ceil(w / 8) * h;
    } else if (format === FORMAT.SPRITES_PLUS_MASK) {
      bytesPerFrame = w * (paddedH / 8) * 2; // interleaved
    } else {
      bytesPerFrame = w * (paddedH / 8);
    }

    if (bytesPerFrame > 0 && dataBytes.length % bytesPerFrame === 0) {
      result.valid = true;
      result.frameCount = dataBytes.length / bytesPerFrame;
    }

    return result;
  };

  /** Infer frame count from data size. */
  Engine._inferFrameCount = function (bytes, w, h, format) {
    var paddedH = Math.ceil(h / 8) * 8;
    var dataBytes = bytes;

    if (format === FORMAT.SPRITES_OVERWRITE || format === FORMAT.SPRITES_EXT_MASK || format === FORMAT.SPRITES_PLUS_MASK) {
      dataBytes = bytes.slice(2);
    }

    var bytesPerFrame;
    if (format === FORMAT.DRAW_SLOW_XY) {
      bytesPerFrame = Math.ceil(w / 8) * h;
    } else if (format === FORMAT.SPRITES_PLUS_MASK) {
      bytesPerFrame = w * (paddedH / 8) * 2;
    } else {
      bytesPerFrame = w * (paddedH / 8);
    }

    if (bytesPerFrame > 0 && dataBytes.length % bytesPerFrame === 0) {
      return dataBytes.length / bytesPerFrame;
    }
    return 1;
  };

  /** Generate dimension candidates for ambiguous arrays. */
  Engine._generateDimensionCandidates = function (bytes, knownFormat) {
    var candidates = [];
    var dataLen = bytes.length;

    // Try with header (first 2 bytes are w,h)
    if (dataLen > 2) {
      var hw = bytes[0];
      var hh = bytes[1];
      if (hw >= 1 && hw <= 128 && hh >= 1 && hh <= 128 && hh % 8 === 0) {
        var hDataLen = dataLen - 2;
        var hBPF = hw * (hh / 8);
        if (hBPF > 0 && hDataLen % hBPF === 0) {
          candidates.push({ w: hw, h: hh, frames: hDataLen / hBPF, score: 90, hasHeader: true });
        }
        // Plus-mask with header
        if (hBPF > 0 && hDataLen % (hBPF * 2) === 0) {
          candidates.push({ w: hw, h: hh, frames: hDataLen / (hBPF * 2), score: 85, hasHeader: true, plusMask: true });
        }
      }
    }

    // Try without header (all bytes are data)
    var commonSizes = [8, 16, 24, 32, 48, 64, 128];
    for (var wi = 0; wi < commonSizes.length; wi++) {
      for (var hi = 0; hi < commonSizes.length; hi++) {
        var w = commonSizes[wi];
        var h = commonSizes[hi];
        var paddedH = Math.ceil(h / 8) * 8;
        var bpf = w * (paddedH / 8);
        if (bpf > 0 && dataLen % bpf === 0 && dataLen / bpf >= 1) {
          var score = 50;
          // Prefer dimensions that result in reasonable frame counts
          var fc = dataLen / bpf;
          if (fc === 1) score += 20;
          else if (fc <= 16) score += 10;
          // Prefer square-ish
          if (w === h) score += 10;
          // Prefer common Arduboy sizes
          if ((w === 16 && h === 16) || (w === 8 && h === 8) || (w === 32 && h === 32)) score += 15;
          if (w === 128 && h === 64) score += 20;

          candidates.push({ w: w, h: h, frames: fc, score: score, hasHeader: false });
        }

        // Horizontal format: bytesPerRow = ceil(w/8)
        var bpr = Math.ceil(w / 8);
        var hTotal = bpr * h;
        if (hTotal > 0 && dataLen % hTotal === 0 && hTotal !== bpf) {
          var hfc = dataLen / hTotal;
          candidates.push({ w: w, h: h, frames: hfc, score: 40, hasHeader: false, horizontal: true });
        }
      }
    }

    // Also try non-standard widths if total is divisible
    for (var testH = 8; testH <= 128; testH += 8) {
      var strips = testH / 8;
      if (dataLen % strips === 0) {
        var testW = dataLen / strips;
        if (testW >= 1 && testW <= 128 && commonSizes.indexOf(testW) === -1) {
          candidates.push({ w: testW, h: testH, frames: 1, score: 30, hasHeader: false });
        }
      }
    }

    // Sort by score descending, then by fewer frames
    candidates.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.frames - b.frames;
    });

    // Deduplicate
    var seen = {};
    var unique = [];
    for (var u = 0; u < candidates.length; u++) {
      var key = candidates[u].w + 'x' + candidates[u].h + (candidates[u].hasHeader ? 'H' : '') + (candidates[u].plusMask ? 'P' : '') + (candidates[u].horizontal ? 'X' : '');
      if (!seen[key]) {
        seen[key] = true;
        unique.push(candidates[u]);
      }
    }

    return unique.slice(0, 6); // top 6
  };

  Engine._escapeRegex = function (str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };


  // ═══════════════════════════════════════════════════════════════════════════
  //  CodeLens provider — exposed for Monaco registration
  // ═══════════════════════════════════════════════════════════════════════════

  var _editCommandId = null;
  var _dimChoiceCommandId = null;
  var _detectionCache = {};
  var _fullDetectionCache = {};

  /**
   * Provide CodeLens items for a Monaco model.
   * Called by Monaco's CodeLens provider infrastructure.
   */
  function provideCodeLenses(model, token) {
    var uri = model.uri.toString();
    // Only process .ino, .cpp, .h, .hpp files
    if (!/\.(ino|cpp|h|hpp|c)$/i.test(uri)) {
      return { lenses: [], dispose: function () {} };
    }

    var sourceText = model.getValue();
    var arrays = Parser.parseArrays(sourceText);

    // Gather all source texts from open tabs for cross-file scanning
    var allSourceTexts = _getAllSourceTexts();

    var lenses = [];
    var cached = [];

    for (var i = 0; i < arrays.length; i++) {
      var arr = arrays[i];
      var detection = Engine.analyzeArray(arr, sourceText, allSourceTexts);

      // Skip very low confidence
      if (detection.confidence < 20 && !detection.compressed) continue;

      // Cache for decoration/hover use
      cached.push({
        declLine: arr.declLine,
        bodyStart: arr.arrayBodyStart,
        bodyEnd: arr.arrayBodyEnd,
        startLine: arr.startLine,
        confidence: detection.confidence,
        compressed: !!detection.compressed,
      });

      var line = arr.declLine;

      if (detection.compressed) {
        // Compressed — informational only
        lenses.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          command: {
            id: '',
            title: '\u{1F5BC}\uFE0F Compressed Bitmap (not editable)',
          },
        });
        continue;
      }

      if (detection.confidence >= 50 && detection.width && detection.height) {
        // High confidence — direct edit
        var label = FORMAT_LABELS[detection.format] || detection.format || 'Bitmap';
        lenses.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          command: {
            id: _editCommandId || '',
            title: '\u{1F5BC}\uFE0F Edit ' + label,
            arguments: [{ arrayInfo: arr, detection: detection }],
          },
        });
      } else if (detection.confidence >= 30 && detection.width && detection.height) {
        // Medium confidence — edit with "?"
        var label2 = FORMAT_LABELS[detection.format] || detection.format || 'Bitmap';
        lenses.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          command: {
            id: _editCommandId || '',
            title: '\u{1F5BC}\uFE0F Edit ' + label2 + '?',
            arguments: [{ arrayInfo: arr, detection: detection }],
          },
        });
      } else if (detection.confidence >= 20) {
        // Low confidence — show dimension candidates
        var candidates = detection.dimensionCandidates;
        if (candidates.length === 0 && detection.width && detection.height) {
          candidates = [{ w: detection.width, h: detection.height, frames: detection.frameCount }];
        }
        for (var c = 0; c < Math.min(candidates.length, 4); c++) {
          var cand = candidates[c];
          var candDetection = {};
          for (var dk in detection) candDetection[dk] = detection[dk];
          candDetection.width = cand.w;
          candDetection.height = cand.h;
          candDetection.frameCount = cand.frames || 1;
          // Infer format from candidate
          if (cand.hasHeader && cand.plusMask) candDetection.format = FORMAT.SPRITES_PLUS_MASK;
          else if (cand.hasHeader) candDetection.format = candDetection.format || FORMAT.SPRITES_OVERWRITE;
          else if (cand.horizontal) candDetection.format = FORMAT.DRAW_SLOW_XY;
          else candDetection.format = candDetection.format || FORMAT.DRAW_BITMAP;

          var candLabel = cand.w + '\u00D7' + cand.h;
          if (cand.frames > 1) candLabel += ' (' + cand.frames + 'f)';
          if (cand.hasHeader) candLabel += ' [hdr]';
          lenses.push({
            range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
            command: {
              id: _dimChoiceCommandId || _editCommandId || '',
              title: candLabel + '?',
              arguments: [{ arrayInfo: arr, detection: candDetection }],
            },
          });
        }
      }
    }

    _detectionCache[uri] = cached;
    _fullDetectionCache[uri] = lenses;
    if (window.BitmapDetector && window.BitmapDetector._onDetectionsUpdated) {
      window.BitmapDetector._onDetectionsUpdated(uri);
    }

    return { lenses: lenses, dispose: function () {} };
  }

  /**
   * Gather all source texts from open tabs for cross-file analysis.
   * Returns [{text, tabId}]. Relies on global `tabs` array from app.js.
   */
  function _getAllSourceTexts() {
    var result = [];
    if (typeof tabs !== 'undefined') {
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        if (tab.model && !tab.isBinary) {
          result.push({ text: tab.model.getValue(), tabId: tab.id });
        }
      }
    }
    return result;
  }

  /**
   * Register Monaco commands. Called once during init.
   * Returns the command IDs.
   */
  function registerCommands(editorInstance) {
    _editCommandId = editorInstance.addCommand(0, function (ctx, args) {
      if (args && window.BitmapDetector._onEditBitmap) {
        window.BitmapDetector._onEditBitmap(args);
      }
    });

    _dimChoiceCommandId = _editCommandId; // same handler

    return { editCommandId: _editCommandId };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  //  Expose public API
  // ═══════════════════════════════════════════════════════════════════════════

  window.BitmapDetector = {
    FORMAT: FORMAT,
    FORMAT_LABELS: FORMAT_LABELS,
    Parser: Parser,
    Codec: Codec,
    Engine: Engine,
    provideCodeLenses: provideCodeLenses,
    registerCommands: registerCommands,
    getDetections: function (uri) { return _detectionCache[uri] || []; },
    getFullDetections: function (uri) { return _fullDetectionCache[uri] || []; },
    _onEditBitmap: null, // set by app.js
    _onDetectionsUpdated: null, // set by app.js
  };

})();
