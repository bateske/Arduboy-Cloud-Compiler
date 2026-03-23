'use strict';

const path   = require('path');
const config = require('./config');

/**
 * Validate a POST /build request body.
 *
 * @param {unknown} body - parsed JSON body
 * @returns {{ valid: true,  files: object, fqbn: string } |
 *           { valid: false, error: string }}
 */
function validateBuildRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const { files, fqbn } = body;

  // ── files map ────────────────────────────────────────────────────────────
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return { valid: false, error: '"files" must be a non-null object map' };
  }

  const entries = Object.entries(files);

  if (entries.length === 0) {
    return { valid: false, error: '"files" must contain at least one entry' };
  }

  if (entries.length > config.MAX_FILES) {
    return { valid: false, error: `Too many files (max ${config.MAX_FILES})` };
  }

  let totalBytes = 0;

  for (const [name, content] of entries) {
    // Reject path traversal, absolute paths, backslashes, null bytes
    if (
      typeof name !== 'string' ||
      name.includes('..') ||
      path.isAbsolute(name) ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.endsWith('/')
    ) {
      return { valid: false, error: `Unsafe filename: "${name}"` };
    }

    // Allow only safe path characters: letters, digits, _ . - and forward slash for subdirs
    if (!/^[a-zA-Z0-9_.\\/\\-]+$/.test(name)) {
      return { valid: false, error: `Invalid characters in filename: "${name}"` };
    }

    // Reject empty path segments (e.g. "foo//bar")
    if (name.split('/').some(seg => seg.length === 0)) {
      return { valid: false, error: `Invalid path segments in filename: "${name}"` };
    }

    if (typeof content !== 'string') {
      return { valid: false, error: `File content must be a string for: "${name}"` };
    }

    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  if (totalBytes > config.MAX_REQUEST_BYTES) {
    return {
      valid: false,
      error: `Total content size (${totalBytes} bytes) exceeds limit (${config.MAX_REQUEST_BYTES} bytes)`,
    };
  }

  // arduino-cli requires exactly one .ino file whose base name matches the sketch dir
  const inoFiles = entries.filter(([n]) => n.endsWith('.ino'));
  if (inoFiles.length === 0) {
    return { valid: false, error: 'At least one .ino file is required' };
  }
  if (inoFiles.length > 1) {
    return { valid: false, error: 'Only one .ino file is allowed per build' };
  }

  // ── fqbn ─────────────────────────────────────────────────────────────────
  const resolvedFqbn =
    typeof fqbn === 'string' && fqbn.trim() ? fqbn.trim() : config.DEFAULT_FQBN;

  // Format: vendor:arch:board  or  vendor:arch:board:menu1=val1,menu2=val2,...
  if (!/^[a-zA-Z0-9_.\-]+(:[a-zA-Z0-9_.\-]+){2}(:[a-zA-Z0-9_.\-=,]+)?$/.test(resolvedFqbn)) {
    return { valid: false, error: `Invalid FQBN format: "${resolvedFqbn}"` };
  }

  return { valid: true, files, fqbn: resolvedFqbn };
}

module.exports = { validateBuildRequest };
