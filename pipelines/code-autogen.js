'use strict';
/**
 * Pipeline ③ — Claude Code CLI × Desktop Dispatch コード自動生成
 * Dispatch Webhook → Antigravity CODEX → Claude Code CLI → Git Commit → Deploy
 */

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs').promises;
const Anthropic = require('@anthropic-ai/sdk');
const codex = require('./antigravity-codex');

const anthropic = new Anthropic();

const ALLOWED_TASKS = new Set([
  'add-api-endpoint',
  'fix-bug',
  'add-test',
  'refactor',
  'add-ui-component',
  'db-migration',
  'add-validation',
]);

async function codeAutogenPipeline(config, progress) {
  const {
    task,
    context = {},
    dispatchSource = 'api',
    dryRun = false,
    repoDir = path.join(__dirname, '..'),
  } = config;

  if (!task || task.trim().length < 5) {
    throw new Error('task は5文字以上の説明が必要です');
  }

  const outputDir = '/tmp/pipeline-output';
  await fs.mkdir(outputDir, { recursive: true });
  const jobDir = path.join(outputDir, `codegen-${Date.now()}`);
  await fs.mkdir(jobDir, { recursive: true });

  // Step 1: ディスパッチイベントの記録
  progress('Dispatch イベントを受信・検証中', 10);
  const dispatchLog = {
    source: dispatchSource,
    task,
    context,
    receivedAt: new Date().toISOString(),
    dryRun,
  };
  await fs.writeFile(
    path.join(jobDir, 'dispatch.json'),
    JSON.stringify(dispatchLog, null, 2)
  );

  // Step 2: Antigravity CODEX でタスクプロンプト構築
  progress('CODEX がタスクプロンプトを構築中', 20);
  const codegenPrompt = codex.codegenPrompt(task, {
    repo: context.repo || 'care-facility-app-',
    branch: context.branch || 'main',
    ...context,
  });

  // Step 3: Claude API でコード計画を生成
  progress('Claude がコード実装計画を生成中', 35);
  const planRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `あなたはNode.js/Express エキスパートです。
既存コードベース（care-facility-app-）の構造を理解した上で、
変更計画と具体的なコードを生成してください。
コードは即座に使用可能な完全な形で出力してください。`,
    messages: [{ role: 'user', content: codegenPrompt }],
  });
  const plan = planRes.content.find(b => b.type === 'text')?.text || '';
  await fs.writeFile(path.join(jobDir, 'plan.md'), plan, 'utf8');

  // Step 4: Claude Code CLI で実行（dry-run または実際の実行）
  progress('Claude Code CLI でコードを生成中', 55);
  const codeCliResult = await executeClaudeCodeCLI(task, plan, repoDir, jobDir, dryRun);

  // Step 5: Git ステータス確認
  progress('Git の変更を確認中', 75);
  const gitStatus = await getGitStatus(repoDir);
  await fs.writeFile(path.join(jobDir, 'git-status.txt'), gitStatus, 'utf8');

  // Step 6: コミットメッセージ生成 & コミット（dryRun でない場合）
  progress('コミットメッセージを生成中', 88);
  const commitMessage = await generateCommitMessage(task, plan);
  let commitHash = null;

  if (!dryRun && codeCliResult.filesChanged.length > 0) {
    commitHash = await commitChanges(repoDir, commitMessage, codeCliResult.filesChanged);
  }

  progress('完了', 100);
  return {
    task,
    dispatchSource,
    dryRun,
    plan,
    codeCliResult,
    gitStatus,
    commitMessage,
    commitHash,
    jobDir,
  };
}

// ── Claude Code CLI 実行 ───────────────────────────────────
async function executeClaudeCodeCLI(task, plan, repoDir, jobDir, dryRun) {
  const cliBinary = process.env.CLAUDE_CODE_CLI || 'claude';
  const outputFile = path.join(jobDir, 'claude-code-output.txt');

  // Claude Code CLI コマンド構築
  // `claude --print` モードで非インタラクティブ実行
  const prompt = `以下のタスクをこのNode.js/Expressリポジトリで実装してください:

${task}

実装計画:
${plan.slice(0, 1000)}

${dryRun ? '注意: これはドライランです。実際のファイル変更は行わず、変更計画のみ出力してください。' : '実際にファイルを変更し、完全な実装を行ってください。'}`;

  const args = ['--print', '--output-format', 'json'];
  if (dryRun) args.push('--no-permission-prompt');

  let stdout = '';
  let stderr = '';
  let filesChanged = [];

  try {
    const result = await execFileAsync(cliBinary, [...args, prompt], {
      cwd: repoDir,
      timeout: 300_000,
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
    });
    stdout = result.stdout;
    stderr = result.stderr;

    // 変更されたファイルのリストを抽出（Claude Code CLIのJSON出力から）
    try {
      const parsed = JSON.parse(stdout);
      filesChanged = parsed.filesChanged || parsed.file_changes || [];
    } catch {
      // JSON出力でない場合はテキスト解析
      const matches = stdout.match(/(?:modified|created|deleted):\s+(\S+)/g) || [];
      filesChanged = matches.map(m => m.split(':')[1].trim());
    }

    await fs.writeFile(outputFile, stdout, 'utf8');
  } catch (err) {
    // Claude Code CLI 未インストールの場合はフォールバック
    if (err.code === 'ENOENT' || err.code === 127) {
      console.warn('[Pipeline③] Claude Code CLI 未検出 — プラン出力モード');
      stdout = `[PLAN MODE]\n\n${plan}`;
      filesChanged = [];
    } else {
      stdout = err.stdout || '';
      stderr = err.stderr || err.message;
    }
    await fs.writeFile(outputFile, stdout || plan, 'utf8');
  }

  return { stdout, stderr, filesChanged, outputFile };
}

// ── Git Operations ─────────────────────────────────────────
async function getGitStatus(repoDir) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: repoDir });
    return stdout;
  } catch {
    return '(git status 取得不可)';
  }
}

async function generateCommitMessage(task, plan) {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `以下のタスクに対する簡潔なgitコミットメッセージを1行で生成してください（英語、50文字以内）:
タスク: ${task}
形式: <type>: <description>（例: feat: add facility export api）`,
    }],
  });
  return res.content.find(b => b.type === 'text')?.text?.trim() || `feat: ${task.slice(0, 50)}`;
}

async function commitChanges(repoDir, message, files) {
  try {
    for (const file of files) {
      await execFileAsync('git', ['add', file], { cwd: repoDir });
    }
    const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: repoDir });
    const hashMatch = stdout.match(/\[[\w\s]+\s+([a-f0-9]{7})\]/);
    return hashMatch?.[1] || null;
  } catch (err) {
    console.warn('[Pipeline③] git commit 失敗:', err.message);
    return null;
  }
}

// ── Dispatch Webhook ハンドラー ────────────────────────────
// Desktop Dispatch からの Webhook を検証する
function validateDispatchWebhook(req) {
  const secret = process.env.DISPATCH_WEBHOOK_SECRET;
  if (!secret) return true; // シークレット未設定の場合はスキップ

  const signature = req.headers['x-dispatch-signature'];
  if (!signature) return false;

  const { createHmac } = require('crypto');
  const expected = createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return `sha256=${expected}` === signature;
}

module.exports = { codeAutogenPipeline, validateDispatchWebhook };
