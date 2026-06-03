'use strict';
/**
 * Pipeline Manager — Job queue, status tracking, pipeline orchestration.
 * In-memory store (upgrade to Redis/DB for production).
 */

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
};

const PIPELINE_TYPES = {
  FACILITY_VIDEO: 'facilityVideo',
  DRIVE_TO_VIDEO: 'driveToVideo',
  CODE_AUTOGEN: 'codeAutogen',
  SNS_CONTENT: 'snsContent',
};

class PipelineManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.pipelines = {};
    this.concurrency = parseInt(process.env.PIPELINE_CONCURRENCY || '2');
    this._running = 0;
    this._queue = [];
  }

  registerPipeline(type, handler) {
    this.pipelines[type] = handler;
  }

  enqueue(type, config, triggeredBy = 'api') {
    if (!this.pipelines[type]) throw new Error(`Unknown pipeline type: ${type}`);

    const job = {
      id: randomUUID(),
      type,
      config,
      triggeredBy,
      status: JOB_STATUS.PENDING,
      progress: 0,
      steps: [],
      output: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };

    this.jobs.set(job.id, job);
    this._queue.push(job.id);
    this.emit('enqueued', job);
    setImmediate(() => this._tick());
    return job;
  }

  _tick() {
    if (this._running >= this.concurrency || this._queue.length === 0) return;
    const jobId = this._queue.shift();
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JOB_STATUS.PENDING) return this._tick();
    this._run(job);
  }

  async _run(job) {
    this._running++;
    job.status = JOB_STATUS.RUNNING;
    job.startedAt = new Date().toISOString();
    this.emit('started', job);

    try {
      const handler = this.pipelines[job.type];
      const result = await handler(job.config, (step, pct) => {
        job.steps.push({ step, pct, ts: new Date().toISOString() });
        job.progress = pct;
        this.emit('progress', job, step, pct);
      });
      job.status = JOB_STATUS.DONE;
      job.output = result;
    } catch (err) {
      job.status = JOB_STATUS.FAILED;
      job.error = err.message;
      this.emit('failed', job, err);
    } finally {
      job.finishedAt = new Date().toISOString();
      this._running--;
      this.emit('finished', job);
      this._tick();
    }
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }

  listJobs(filter = {}) {
    let jobs = [...this.jobs.values()];
    if (filter.type) jobs = jobs.filter(j => j.type === filter.type);
    if (filter.status) jobs = jobs.filter(j => j.status === filter.status);
    return jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  }

  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== JOB_STATUS.PENDING) return false;
    job.status = JOB_STATUS.FAILED;
    job.error = 'Cancelled by user';
    job.finishedAt = new Date().toISOString();
    const qi = this._queue.indexOf(id);
    if (qi !== -1) this._queue.splice(qi, 1);
    return true;
  }

  stats() {
    const all = [...this.jobs.values()];
    return {
      total: all.length,
      pending: all.filter(j => j.status === JOB_STATUS.PENDING).length,
      running: all.filter(j => j.status === JOB_STATUS.RUNNING).length,
      done: all.filter(j => j.status === JOB_STATUS.DONE).length,
      failed: all.filter(j => j.status === JOB_STATUS.FAILED).length,
      queueDepth: this._queue.length,
    };
  }
}

const manager = new PipelineManager();

module.exports = { manager, PIPELINE_TYPES, JOB_STATUS };
