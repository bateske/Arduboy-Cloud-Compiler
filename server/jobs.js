'use strict';

const { randomUUID } = require('crypto');

const config          = require('./config');
const { compile }     = require('./compile');
const { rmDir }       = require('./util');

// ── Job status constants ───────────────────────────────────────────────────
const Status = Object.freeze({
  QUEUED:   'queued',
  BUILDING: 'building',
  DONE:     'done',
  ERROR:    'error',
});

/** @type {Map<string, object>} */
const jobs = new Map();

/** @type {string[]} FIFO queue of pending job IDs */
const queue = [];

let workerBusy = false;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new job, add it to the queue, and return the job object.
 *
 * @param {object} files  - validated files map
 * @param {string} fqbn   - validated FQBN string
 * @returns {object} job
 */
function createJob(files, fqbn) {
  const id = randomUUID();
  const job = {
    id,
    files,
    fqbn,
    status:    Status.QUEUED,
    log:       '',
    hex:       null,
    error:     null,
    tmpDir:    null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  queue.push(id);
  // Kick the worker after the current call stack unwinds so the HTTP
  // response for POST /build is sent before we start blocking work.
  setImmediate(flushQueue);
  return job;
}

/**
 * Retrieve a job by ID.
 *
 * @param {string} id
 * @returns {object|null}
 */
function getJob(id) {
  return jobs.get(id) ?? null;
}

// ── Internal worker ────────────────────────────────────────────────────────

function flushQueue() {
  if (workerBusy || queue.length === 0) return;

  const id = queue.shift();
  const job = jobs.get(id);

  if (!job) {
    // Job was already cleaned up (e.g. TTL expired before worker got to it)
    flushQueue();
    return;
  }

  workerBusy = true;
  job.status = Status.BUILDING;

  compile(job)
    .then(() => {
      job.status = Status.DONE;
    })
    .catch(err => {
      job.status = Status.ERROR;
      job.error  = err.message;
      job.log   += `\n[error] ${err.message}\n`;
    })
    .finally(() => {
      workerBusy = false;
      scheduleCleanup(id);
      flushQueue(); // process the next queued job
    });
}

function scheduleCleanup(id) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (job?.tmpDir) rmDir(job.tmpDir);
    jobs.delete(id);
    console.log(`[jobs] Purged job ${id}`);
  }, config.JOB_TTL_MS);
}

module.exports = { createJob, getJob, Status };
