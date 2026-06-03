'use strict';
/**
 * Pipeline ① — 施設紹介動画自動生成
 * DB → Claude Script → Gemini TTS → Remotion Render → FFMPEG → MP4 → Google Drive
 */

const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const Anthropic = require('@anthropic-ai/sdk');
const codex = require('./antigravity-codex');

const anthropic = new Anthropic();

async function facilityVideoPipeline(config, progress) {
  const { facilityId, pool, outputDir = '/tmp/pipeline-output' } = config;

  await fs.mkdir(outputDir, { recursive: true });
  const jobDir = path.join(outputDir, `facility-video-${facilityId}-${Date.now()}`);
  await fs.mkdir(jobDir, { recursive: true });

  // Step 1: DBから施設データ取得
  progress('施設データを取得中', 5);
  const { rows: facRows } = await pool.query(
    'SELECT * FROM facilities WHERE id = $1', [facilityId]
  );
  if (!facRows.length) throw new Error(`施設ID ${facilityId} が見つかりません`);
  const facility = facRows[0];

  const { rows: evaluations } = await pool.query(
    `SELECT e.*, u.name as user_name FROM evaluations e
     LEFT JOIN users u ON e.user_id = u.id
     WHERE e.facility_id = $1`, [facilityId]
  );

  // Step 2: Claude でナレーション原稿生成
  progress('Claude がナレーション原稿を生成中', 20);
  const prompt = codex.facilityVideoPrompt(facility, evaluations);
  const claudeRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });
  const narration = claudeRes.content.find(b => b.type === 'text')?.text || '';
  await fs.writeFile(path.join(jobDir, 'narration.txt'), narration, 'utf8');

  // Step 3: Gemini TTS で音声生成
  progress('Gemini TTS で音声を生成中', 40);
  const audioPath = path.join(jobDir, 'narration.mp3');
  await generateGeminiTTS(narration, audioPath);

  // Step 4: Remotion で映像レンダリング
  progress('Remotion で映像をレンダリング中', 60);
  const compositionSpec = codex.facilityVideoCompositionSpec(facility);
  const videoPath = path.join(jobDir, 'video-raw.mp4');
  await renderRemotionComposition(compositionSpec, videoPath, jobDir);

  // Step 5: FFMPEG で映像+音声を合成
  progress('FFMPEG で動画を合成中', 80);
  const finalPath = path.join(jobDir, `${sanitizeFilename(facility.name)}-intro.mp4`);
  await mergeVideoAudio(videoPath, audioPath, finalPath);

  // Step 6: Google Drive にアップロード
  progress('Google Drive にアップロード中', 90);
  const driveResult = await uploadToDrive(finalPath, facility.name, config.driveConfig);

  progress('完了', 100);
  return {
    facilityId,
    facilityName: facility.name,
    narration,
    localPath: finalPath,
    driveFileId: driveResult?.fileId,
    driveUrl: driveResult?.webViewLink,
    compositonSpec: compositionSpec,
  };
}

// ── Gemini TTS ─────────────────────────────────────────────
async function generateGeminiTTS(text, outputPath) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Fallback: テキストファイルのみ保存（TTS無し）
    console.warn('[Pipeline①] GEMINI_API_KEY 未設定 — TTS をスキップ（無音ダミーを使用）');
    await createSilentAudio(outputPath, 60);
    return;
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  // Gemini 2.5 Flash TTS
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-tts' });
  const result = await model.generateContent({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    },
  });

  const audioData = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error('Gemini TTS: 音声データが取得できませんでした');

  await fs.writeFile(outputPath, Buffer.from(audioData, 'base64'));
}

async function createSilentAudio(outputPath, durationSec) {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
      '-t', String(durationSec),
      '-c:a', 'libmp3lame', '-b:a', '128k',
      '-y', outputPath,
    ]);
  } catch {
    // FFMPEG不在の場合は空ファイル
    await fs.writeFile(outputPath, Buffer.alloc(0));
  }
}

// ── Remotion Render ────────────────────────────────────────
async function renderRemotionComposition(spec, outputPath, jobDir) {
  const specPath = path.join(jobDir, 'composition.json');
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8');

  const remotionDir = path.join(__dirname, '..', 'remotion');
  const remotionExists = await fs.access(remotionDir).then(() => true).catch(() => false);

  if (!remotionExists) {
    console.warn('[Pipeline①] Remotion ディレクトリ未セットアップ — プレースホルダー映像を使用');
    await createPlaceholderVideo(outputPath, spec.durationInFrames / spec.fps, spec.data.facilityName);
    return;
  }

  try {
    await execFileAsync('npx', [
      'remotion', 'render',
      '--composition', spec.type,
      '--props', specPath,
      '--output', outputPath,
    ], { cwd: remotionDir, timeout: 300_000 });
  } catch (err) {
    console.warn('[Pipeline①] Remotion render 失敗 — プレースホルダーを使用:', err.message);
    await createPlaceholderVideo(outputPath, spec.durationInFrames / spec.fps, spec.data.facilityName);
  }
}

async function createPlaceholderVideo(outputPath, durationSec, title) {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi',
      '-i', `color=c=0x2563eb:size=1920x1080:rate=30`,
      '-vf', `drawtext=text='${title}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-t', String(durationSec),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', outputPath,
    ]);
  } catch {
    await fs.writeFile(outputPath, Buffer.alloc(0));
  }
}

// ── FFMPEG Merge ───────────────────────────────────────────
async function mergeVideoAudio(videoPath, audioPath, outputPath) {
  const args = codex.buildFFmpegArgs(videoPath, audioPath, outputPath);
  try {
    await execFileAsync('ffmpeg', args, { timeout: 300_000 });
  } catch (err) {
    // 音声なし映像をそのまま使用
    console.warn('[Pipeline①] FFMPEG merge 失敗:', err.message);
    await fs.copyFile(videoPath, outputPath).catch(() => {});
  }
}

// ── Google Drive Upload ────────────────────────────────────
async function uploadToDrive(filePath, facilityName, driveConfig = {}) {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const folderId = driveConfig.folderId || process.env.DRIVE_FOLDER_ID;

  if (!credentials && !process.env.GOOGLE_DRIVE_TOKEN) {
    console.warn('[Pipeline①] Google Drive 認証情報未設定 — アップロードをスキップ');
    return null;
  }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });
  const fileStream = require('fs').createReadStream(filePath);
  const fileName = path.basename(filePath);

  const res = await drive.files.create({
    requestBody: {
      name: `【施設紹介】${facilityName}_${new Date().toLocaleDateString('ja-JP')}.mp4`,
      mimeType: 'video/mp4',
      parents: folderId ? [folderId] : undefined,
    },
    media: { mimeType: 'video/mp4', body: fileStream },
    fields: 'id,webViewLink',
  });

  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}

// ── Util ───────────────────────────────────────────────────
function sanitizeFilename(name) {
  return name.replace(/[^\w぀-鿿]/g, '-').slice(0, 50);
}

module.exports = facilityVideoPipeline;
