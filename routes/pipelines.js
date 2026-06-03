'use strict';
/**
 * Pipeline API Routes — /api/pipelines/*
 * Endpoints for triggering, monitoring, and managing all 4 pipelines.
 */

const express = require('express');
const router = express.Router();

const { manager, PIPELINE_TYPES, JOB_STATUS } = require('../pipelines/manager');
const codex = require('../pipelines/antigravity-codex');

const facilityVideoPipeline = require('../pipelines/facility-video');
const driveToVideoPipeline = require('../pipelines/drive-to-video');
const { codeAutogenPipeline, validateDispatchWebhook } = require('../pipelines/code-autogen');
const snsContentPipeline = require('../pipelines/sns-content');

// ── パイプラインを登録 ──────────────────────────────────────
function initPipelines(pool) {
  manager.registerPipeline(PIPELINE_TYPES.FACILITY_VIDEO, (config, progress) =>
    facilityVideoPipeline({ ...config, pool }, progress)
  );

  manager.registerPipeline(PIPELINE_TYPES.DRIVE_TO_VIDEO, (config, progress) =>
    driveToVideoPipeline(config, progress)
  );

  manager.registerPipeline(PIPELINE_TYPES.CODE_AUTOGEN, (config, progress) =>
    codeAutogenPipeline(config, progress)
  );

  manager.registerPipeline(PIPELINE_TYPES.SNS_CONTENT, (config, progress) =>
    snsContentPipeline({ ...config, pool }, progress)
  );
}

// ── Auth middleware (admin only) ────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: '未ログインです' });
  next(); // 現状は全認証ユーザーに許可（必要に応じて role チェックを追加）
}

// ── ダッシュボード統計 ──────────────────────────────────────
router.get('/stats', requireAdmin, (req, res) => {
  res.json({
    ...manager.stats(),
    codexVersion: codex.version,
    pipelines: Object.values(PIPELINE_TYPES),
  });
});

// ── ジョブ一覧 ─────────────────────────────────────────────
router.get('/jobs', requireAdmin, (req, res) => {
  const { type, status } = req.query;
  const jobs = manager.listJobs({ type, status });
  res.json(jobs);
});

// ── ジョブ詳細 ─────────────────────────────────────────────
router.get('/jobs/:id', requireAdmin, (req, res) => {
  const job = manager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ジョブが見つかりません' });
  res.json(job);
});

// ── ジョブキャンセル ───────────────────────────────────────
router.delete('/jobs/:id', requireAdmin, (req, res) => {
  const ok = manager.cancelJob(req.params.id);
  if (!ok) return res.status(400).json({ error: 'キャンセルできないジョブです' });
  res.json({ ok: true });
});

// ── Pipeline ① 施設紹介動画 ────────────────────────────────
router.post('/facility-video', requireAdmin, (req, res) => {
  const { facilityId, driveConfig } = req.body;
  if (!facilityId) return res.status(400).json({ error: 'facilityId が必要です' });

  try {
    codex.validateJobConfig(PIPELINE_TYPES.FACILITY_VIDEO, { facilityId });
    const job = manager.enqueue(PIPELINE_TYPES.FACILITY_VIDEO, {
      facilityId: parseInt(facilityId),
      driveConfig: driveConfig || {},
    }, `user:${req.session.user.name}`);
    res.json({ jobId: job.id, status: job.status, message: '施設紹介動画生成ジョブを開始しました' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Pipeline ② Drive → 動画 ────────────────────────────────
router.post('/drive-to-video', requireAdmin, (req, res) => {
  const { folderId, driveConfig } = req.body;
  if (!folderId) return res.status(400).json({ error: 'folderId が必要です' });

  try {
    codex.validateJobConfig(PIPELINE_TYPES.DRIVE_TO_VIDEO, { folderId });
    const job = manager.enqueue(PIPELINE_TYPES.DRIVE_TO_VIDEO, {
      folderId,
      driveConfig: driveConfig || {},
    }, `user:${req.session.user.name}`);
    res.json({ jobId: job.id, status: job.status, message: 'Drive動画変換ジョブを開始しました' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Pipeline ③ コード自動生成 ──────────────────────────────
router.post('/code-autogen', requireAdmin, (req, res) => {
  const { task, context, dryRun } = req.body;
  if (!task) return res.status(400).json({ error: 'task が必要です' });

  try {
    codex.validateJobConfig(PIPELINE_TYPES.CODE_AUTOGEN, { task });
    const job = manager.enqueue(PIPELINE_TYPES.CODE_AUTOGEN, {
      task,
      context: context || {},
      dryRun: dryRun !== false, // デフォルト: dryRun=true（安全のため）
    }, `user:${req.session.user.name}`);
    res.json({ jobId: job.id, status: job.status, message: 'コード生成ジョブを開始しました' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Pipeline ③ Desktop Dispatch Webhook ────────────────────
router.post('/dispatch/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // Webhook body を parse
  let body;
  try {
    body = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  req.body = body;

  if (!validateDispatchWebhook(req)) {
    return res.status(401).json({ error: 'Webhook 署名が不正です' });
  }

  const { task, context, dryRun } = body;
  if (!task) return res.status(400).json({ error: 'task が必要です' });

  const job = manager.enqueue(PIPELINE_TYPES.CODE_AUTOGEN, {
    task,
    context: context || {},
    dryRun: dryRun !== false,
  }, 'desktop-dispatch');

  res.json({ jobId: job.id, status: job.status });
});

// ── Pipeline ④ SNSコンテンツ量産 ──────────────────────────
router.post('/sns-content', requireAdmin, (req, res) => {
  const { facilityIds, driveConfig } = req.body;
  if (!Array.isArray(facilityIds) || !facilityIds.length) {
    return res.status(400).json({ error: 'facilityIds（配列）が必要です' });
  }

  try {
    codex.validateJobConfig(PIPELINE_TYPES.SNS_CONTENT, { facilityIds });
    const job = manager.enqueue(PIPELINE_TYPES.SNS_CONTENT, {
      facilityIds: facilityIds.map(Number),
      driveConfig: driveConfig || {},
    }, `user:${req.session.user.name}`);
    res.json({
      jobId: job.id,
      status: job.status,
      message: `${facilityIds.length}件の施設のSNSコンテンツ生成を開始しました`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── SSE: ジョブ進捗ストリーミング ──────────────────────────
router.get('/jobs/:id/stream', requireAdmin, (req, res) => {
  const job = manager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ジョブが見つかりません' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 現在の状態を即時送信
  send('status', { status: job.status, progress: job.progress, steps: job.steps });
  if (job.status === JOB_STATUS.DONE || job.status === JOB_STATUS.FAILED) {
    send(job.status, { output: job.output, error: job.error });
    return res.end();
  }

  const onProgress = (j, step, pct) => {
    if (j.id !== job.id) return;
    send('progress', { step, pct });
  };
  const onFinished = (j) => {
    if (j.id !== job.id) return;
    send(j.status, { output: j.output, error: j.error });
    cleanup();
    res.end();
  };

  manager.on('progress', onProgress);
  manager.on('finished', onFinished);

  function cleanup() {
    manager.off('progress', onProgress);
    manager.off('finished', onFinished);
  }

  req.on('close', cleanup);
});

module.exports = { router, initPipelines };
