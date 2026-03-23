'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Recursively delete a directory, silently ignoring errors.
 *
 * @param {string} dirPath
 */
function rmDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err) {
    console.error(`[util] rmDir failed for ${dirPath}: ${err.message}`);
  }
}

/**
 * Walk a directory tree and return the path of the first .hex file that is
 * NOT a bootloader variant (arduino-cli names those "with_bootloader").
 *
 * arduino-cli places output at:
 *   <sketchDir>/build/<vendor>.<arch>.<board>/<sketch>.ino.hex
 * so a recursive walk is needed rather than a flat search.
 *
 * @param {string} baseDir
 * @returns {string|null}  absolute path to hex file, or null if not found
 */
function findHexFileDeep(baseDir) {
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return null;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const found = walk(fullPath);
        if (found) return found;
      } else if (
        /\.hex$/i.test(entry.name) &&
        !entry.name.toLowerCase().includes('with_bootloader')
      ) {
        return fullPath;
      }
    }
    return null;
  }

  return walk(baseDir);
}

module.exports = { rmDir, findHexFileDeep };
