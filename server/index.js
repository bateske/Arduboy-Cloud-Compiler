'use strict';

const express           = require('express');
const fs                = require('fs');
const path              = require('path');
const { execFile }      = require('child_process');
const { promisify }     = require('util');

const config                        = require('./config');
const { validateBuildRequest }      = require('./validate');
const { createJob, getJob, Status } = require('./jobs');
const { buildRateLimit }            = require('./rateLimit');

const execFileP = promisify(execFile);
const app       = express();

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: config.MAX_REQUEST_BYTES }));

// Serve compiler frontend assets under /compiler/ prefix
app.use('/compiler', express.static(path.join(__dirname, '..', 'web')));

// Serve cloud overlay library
app.use('/cloud-overlay', express.static(path.join(__dirname, '..', 'CloudOverlay')));

// Serve the merged Webtools+Compiler SPA from the Webtools Vite build output
app.use(express.static(config.WEBTOOLS_DIST));

// ── POST /build ───────────────────────────────────────────────────────────
app.post('/build', buildRateLimit, (req, res) => {
  const result = validateBuildRequest(req.body);
  if (!result.valid) {
    return res.status(400).json({ ok: false, error: result.error });
  }

  const job = createJob(result.files, result.fqbn);
  return res.json({ ok: true, id: job.id, status: job.status });
});

// ── GET /poll?id=<jobid> ──────────────────────────────────────────────────
app.get('/poll', (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ ok: false, error: 'Missing query parameter: id' });
  }

  const job = getJob(id);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job not found or expired' });
  }

  switch (job.status) {
    case Status.DONE:
      return res.json({ ok: true, status: job.status, log: job.log, hex: job.hex });

    case Status.ERROR:
      return res.json({ ok: false, status: job.status, log: job.log, error: job.error });

    default:
      // QUEUED or BUILDING — client should keep polling
      return res.json({ ok: true, status: job.status, log: job.log });
  }
});

// ── GET /build/:id.hex ────────────────────────────────────────────────────
app.get('/build/:file', (req, res) => {
  const match = req.params.file.match(/^([0-9a-f-]{36})\.hex$/i);
  if (!match) {
    return res.status(400).send('Invalid hex filename — expected <uuid>.hex');
  }

  const jobId = match[1];
  const job   = getJob(jobId);

  if (!job || job.status !== Status.DONE || !job.hex) {
    return res.status(404).send('Hex not available for this job');
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${jobId}.hex"`);
  return res.send(job.hex);
});

// ── GET /libraries ────────────────────────────────────────────────────────
// Discovers Arduino libraries bundled with installed board packages and cores.
// Scans the standard arduino-cli data directory for libraries/ folders.
app.get('/libraries', async (req, res) => {
  const dataDir = process.env.ARDUINO_DATA_DIR || path.join(require('os').homedir(), '.arduino15');
  const libs = [];

  // Scan board-package libraries: packages/<pkg>/hardware/<arch>/<ver>/libraries/*
  const packagesDir = path.join(dataDir, 'packages');
  try {
    for (const pkg of fs.readdirSync(packagesDir)) {
      const hwDir = path.join(packagesDir, pkg, 'hardware');
      if (!fs.existsSync(hwDir)) continue;
      for (const arch of fs.readdirSync(hwDir)) {
        const archDir = path.join(hwDir, arch);
        for (const ver of fs.readdirSync(archDir)) {
          const libsDir = path.join(archDir, ver, 'libraries');
          if (!fs.existsSync(libsDir)) continue;
          for (const libName of fs.readdirSync(libsDir)) {
            const libPath = path.join(libsDir, libName);
            if (!fs.statSync(libPath).isDirectory()) continue;

            const entry = { name: libName, source: `${pkg}:${arch}` };

            // Try to read library.properties for richer metadata
            const propsFile = path.join(libPath, 'library.properties');
            if (fs.existsSync(propsFile)) {
              const props = fs.readFileSync(propsFile, 'utf8');
              for (const line of props.split(/\r?\n/)) {
                const eq = line.indexOf('=');
                if (eq < 0) continue;
                const key = line.slice(0, eq).trim();
                const val = line.slice(eq + 1).trim();
                if (key === 'version')  entry.version  = val;
                if (key === 'sentence') entry.sentence = val;
                if (key === 'author')   entry.author   = val;
                if (key === 'url')      entry.url      = val;
                if (key === 'includes') entry.includes = val.split(',').map(s => s.trim()).filter(Boolean);
              }
            }

            // Fallback: scan src/ or root for .h files if includes not specified
            if (!entry.includes) {
              const srcDir = path.join(libPath, 'src');
              const scanDir = fs.existsSync(srcDir) ? srcDir : libPath;
              try {
                const headers = fs.readdirSync(scanDir).filter(f => f.endsWith('.h'));
                if (headers.length) entry.includes = [headers[0]];
              } catch (_) { /* ignore */ }
            }

            libs.push(entry);
          }
        }
      }
    }
  } catch (err) {
    // packagesDir may not exist in non-Docker dev environments
  }

  // Deduplicate by name (prefer board-package version over core built-in)
  const seen = new Map();
  for (const lib of libs) {
    if (!seen.has(lib.name)) seen.set(lib.name, lib);
  }

  res.json({ ok: true, libraries: Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)) });
});

// ── GET /version ──────────────────────────────────────────────────────────
app.get('/version', async (req, res) => {
  const [versionResult, coresResult] = await Promise.allSettled([
    execFileP(config.ARDUINO_CLI, ['version']),
    execFileP(config.ARDUINO_CLI, ['core', 'list']),
  ]);

  res.json({
    ok: true,
    version: versionResult.status === 'fulfilled'
      ? versionResult.value.stdout.trim()
      : `error: ${versionResult.reason.message}`,
    cores: coresResult.status === 'fulfilled'
      ? coresResult.value.stdout.trim()
      : `error: ${coresResult.reason.message}`,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(config.PORT, config.HOST, async () => {
  console.log(`[server] Arduboy Cloud Compiler listening on ${config.HOST}:${config.PORT}`);

  // Log arduino-cli version and installed cores at startup for quick diagnostics.
  // Surfaces misconfiguration (missing binary, wrong PATH, bad ARDUINO_DATA_DIR)
  // immediately rather than on the first compile job.
  try {
    const [vResult, cResult] = await Promise.allSettled([
      execFileP(config.ARDUINO_CLI, ['version']),
      execFileP(config.ARDUINO_CLI, ['core', 'list']),
    ]);
    const v = vResult.status === 'fulfilled'
      ? vResult.value.stdout.trim()
      : `unavailable: ${vResult.reason.message}`;
    const c = cResult.status === 'fulfilled'
      ? cResult.value.stdout.trim()
      : `unavailable: ${cResult.reason.message}`;
    console.log(`[server] ${v}`);
    console.log(`[server] Installed cores:\n${c}`);
  } catch (err) {
    console.error(`[server] Could not query arduino-cli: ${err.message}`);
  }
});

module.exports = app;
