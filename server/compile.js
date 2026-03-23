'use strict';

const fs           = require('fs');
const path         = require('path');
const { spawn }    = require('child_process');

const config                     = require('./config');
const { rmDir, findHexFileDeep } = require('./util');

/**
 * Compile the sketch described by `job`.
 *
 * Mutates: job.tmpDir, job.log, job.hex
 * Throws on any error (caller catches and sets job.status = 'error').
 *
 * @param {{ id: string, files: object, fqbn: string, log: string, hex: string|null, tmpDir: string|null }} job
 */
async function compile(job) {
  // ── 1. Create isolated temp directory ─────────────────────────────────────
  fs.mkdirSync(config.TMP_BASE, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(config.TMP_BASE, 'job-'));
  job.tmpDir = tmpDir;

  // ── 2. Create sketch directory ─────────────────────────────────────────────
  // arduino-cli requires the folder name to match the .ino base name.
  // We always use "Sketch" to avoid edge cases with user-supplied filenames
  // (e.g. "main" is a reserved identifier in C which can confuse some toolchains).
  const sketchDir = path.join(tmpDir, 'Sketch');
  fs.mkdirSync(sketchDir);

  // ── 3. Write source files ──────────────────────────────────────────────────
  for (const [filename, content] of Object.entries(job.files)) {
    // The .ino must be written as Sketch.ino to match the directory name.
    // Other files (.h, .cpp, etc.) keep their original names.
    const destName = filename.endsWith('.ino') ? 'Sketch.ino' : filename;
    const destPath = path.join(sketchDir, destName);

    // Create subdirectories if the filename contains path separators
    const destDir = path.dirname(destPath);
    if (destDir !== sketchDir) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.writeFileSync(destPath, content, 'utf8');
  }

  // ── 4. Invoke arduino-cli ──────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const args = [
      'compile',
      '--fqbn',            job.fqbn,
      '--export-binaries',
      sketchDir,
    ];

    const child = spawn(config.ARDUINO_CLI, args, {
      timeout:    config.COMPILE_TIMEOUT_MS,
      killSignal: 'SIGTERM',
    });

    let log = `$ ${config.ARDUINO_CLI} ${args.join(' ')}\n`;

    const append = chunk => {
      log += chunk.toString();
      job.log = log; // live update so /poll always returns latest partial log
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);

    child.on('error', err => {
      job.log = log;
      reject(new Error(`Failed to spawn arduino-cli: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      job.log = log;

      if (code === null && signal !== null) {
        // Killed by a signal. The only signal we send is SIGTERM via the spawn
        // timeout option, so treat any signal-based exit as a timeout.
        return reject(new Error(
          `Compile timed out after ${config.COMPILE_TIMEOUT_MS} ms`
        ));
      }
      if (code !== 0) {
        return reject(new Error(`arduino-cli exited with code ${code}`));
      }

      const hexPath = findHexFileDeep(sketchDir);
      if (!hexPath) {
        return reject(new Error('Compile succeeded but no .hex file was produced'));
      }

      job.hex = fs.readFileSync(hexPath, 'utf8');
      resolve();
    });
  });
}

module.exports = { compile };
