'use strict';

const os   = require('os');
const path = require('path');

module.exports = {
  // Server binding
  PORT: parseInt(process.env.PORT || '8080', 10),
  HOST: '0.0.0.0',

  // Safety limits
  MAX_REQUEST_BYTES:  512 * 1024,      // 512 KB total body
  MAX_FILES:          20,              // max files per build request
  COMPILE_TIMEOUT_MS: 60 * 1000,      // 60 s compile wall-clock limit
  JOB_TTL_MS:         10 * 60 * 1000, // 10 min before job + tmpdir purged

  // Build defaults
  DEFAULT_FQBN: 'arduboy-homemade:avr:arduboy-fx:core=arduboy-core',

  // Paths — overridable via environment for Docker / local dev
  TMP_BASE:      process.env.TMP_BASE      || path.join(os.tmpdir(), 'arduboy-builds'),
  ARDUINO_CLI:   process.env.ARDUINO_CLI   || 'arduino-cli',
  WEBTOOLS_DIST: process.env.WEBTOOLS_DIST || path.join(__dirname, '..', 'webtools'),
};
