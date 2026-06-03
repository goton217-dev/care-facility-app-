'use strict';
/**
 * Pipeline ② — Google Drive コンテンツ → 動画化
 * Drive Folder → Download → Remotion Slideshow → Gemini TTS → FFMPEG → MP4 → Drive
 */

const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const Anthropic = require('@anthropic-ai/sdk');
const codex = require('./antigravity-codex');

const anthropic = new Anthropic();

async function driveToVideoPipeline(config, progress) {
  const { folderId, outputDir = '/tmp/pipeline-output', driveConfig = {} } = config;

  const jobDir = path.join(outputDir, `drive-video-${Date.now()}`);
  await fs.mkdir(jobDir, { recursive: true });
  const assetsDir = path.join(jobDir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  // Step 1: Google Drive からファイル一覧を取得
  progress('Drive フォルダを確認中', 10);
  const driveFiles = await listDriveFiles(folderId, driveConfig);
  if (!driveFiles.length) throw new Error('指定フォルダにファイルがありません');

  // Step 2: ファイルをダウンロード（画像のみ対象）
  progress('Drive からファイルをダウンロード中', 25);
  const imageFiles = driveFiles.filter(f =>
    f.mimeType && (f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf')
  );
  const downloaded = await downloadDriveFiles(imageFiles, assetsDir, driveConfig);

  // Step 3: Claude でナレーション生成
  progress('Claude がナレーションを生成中', 40);
  const narrationPrompt = codex.driveNarrationPrompt(driveFiles);
  const claudeRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: narrationPrompt }],
  });
  const narration = claudeRes.content.find(b => b.type === 'text')?.text || '';
  await fs.writeFile(path.join(jobDir, 'narration.txt'), narration, 'utf8');

  // Step 4: Gemini TTS
  progress('Gemini TTS で音声を生成中', 55);
  const audioPath = path.join(jobDir, 'narration.mp3');
  await generateGeminiTTS(narration, audioPath);

  // Step 5: Remotion でスライドショーレンダリング
  progress('Remotion でスライドショーを生成中', 70);
  const compositionSpec = codex.driveVideoCompositionSpec(driveFiles, narration);
  compositionSpec.data.assetDir = assetsDir;
  const videoPath = path.join(jobDir, 'slideshow-raw.mp4');
  await renderRemotionComposition(compositionSpec, videoPath, jobDir, downloaded);

  // Step 6: FFMPEG で合成
  progress('FFMPEG で動画を合成中', 85);
  const finalPath = path.join(jobDir, `drive-slideshow-${Date.now()}.mp4`);
  await mergeVideoAudio(videoPath, audioPath, finalPath);

  // Step 7: Drive にアップロード
  progress('Google Drive にアップロード中', 95);
  const driveResult = await uploadToDrive(finalPath, folderId, driveConfig);

  progress('完了', 100);
  return {
    folderId,
    fileCount: driveFiles.length,
    imageCount: downloaded.length,
    narration,
    localPath: finalPath,
    driveFileId: driveResult?.fileId,
    driveUrl: driveResult?.webViewLink,
  };
}

// ── Google Drive Operations ────────────────────────────────
async function getDriveClient(driveConfig = {}) {
  const token = process.env.GOOGLE_DRIVE_TOKEN || driveConfig.token;
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!token && !credentials) {
    throw new Error('Google Drive 認証情報が設定されていません（GOOGLE_APPLICATION_CREDENTIALS または GOOGLE_DRIVE_TOKEN）');
  }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
  return google.drive({ version: 'v3', auth });
}

async function listDriveFiles(folderId, driveConfig) {
  try {
    const drive = await getDriveClient(driveConfig);
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,size)',
      pageSize: 50,
    });
    return res.data.files || [];
  } catch (err) {
    console.warn('[Pipeline②] Drive ファイル一覧取得失敗:', err.message);
    return [];
  }
}

async function downloadDriveFiles(files, destDir, driveConfig) {
  const downloaded = [];
  for (const file of files.slice(0, 20)) { // 最大20ファイル
    try {
      const drive = await getDriveClient(driveConfig);
      const dest = path.join(destDir, `${file.id}-${sanitizeFilename(file.name)}`);
      const writer = createWriteStream(dest);
      const res = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'stream' }
      );
      await new Promise((resolve, reject) => {
        res.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      downloaded.push({ ...file, localPath: dest });
    } catch (err) {
      console.warn(`[Pipeline②] ${file.name} のダウンロード失敗:`, err.message);
    }
  }
  return downloaded;
}

// ── Gemini TTS ─────────────────────────────────────────────
async function generateGeminiTTS(text, outputPath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Pipeline②] GEMINI_API_KEY 未設定 — 無音を使用');
    await createSilentAudio(outputPath, 90);
    return;
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
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
  if (!audioData) throw new Error('Gemini TTS: 音声データ取得失敗');
  await fs.writeFile(outputPath, Buffer.from(audioData, 'base64'));
}

async function createSilentAudio(outputPath, durationSec) {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', String(durationSec), '-c:a', 'libmp3lame', '-b:a', '128k', '-y', outputPath,
    ]);
  } catch {
    await fs.writeFile(outputPath, Buffer.alloc(0));
  }
}

// ── Remotion / Fallback Slideshow ──────────────────────────
async function renderRemotionComposition(spec, outputPath, jobDir, downloadedFiles) {
  const specPath = path.join(jobDir, 'composition.json');
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8');

  const remotionDir = path.join(__dirname, '..', 'remotion');
  const remotionExists = await fs.access(remotionDir).then(() => true).catch(() => false);

  if (!remotionExists || !downloadedFiles.length) {
    await createFallbackSlideshow(downloadedFiles, outputPath, spec.durationInFrames / spec.fps);
    return;
  }

  try {
    await execFileAsync('npx', [
      'remotion', 'render',
      '--composition', spec.type,
      '--props', specPath,
      '--output', outputPath,
    ], { cwd: remotionDir, timeout: 600_000 });
  } catch (err) {
    console.warn('[Pipeline②] Remotion 失敗 — フォールバック使用:', err.message);
    await createFallbackSlideshow(downloadedFiles, outputPath, spec.durationInFrames / spec.fps);
  }
}

async function createFallbackSlideshow(files, outputPath, durationSec) {
  if (!files.length) {
    await createPlaceholderVideo(outputPath, durationSec);
    return;
  }
  const perSlide = Math.floor(durationSec / files.length);
  const inputArgs = files.flatMap(f => ['-loop', '1', '-t', String(perSlide), '-i', f.localPath]);
  const filterParts = files.map((_, i) => `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v${i}]`);
  const concatInput = files.map((_, i) => `[v${i}]`).join('');
  const filterComplex = [
    ...filterParts,
    `${concatInput}concat=n=${files.length}:v=1:a=0[outv]`,
  ].join(';');

  try {
    await execFileAsync('ffmpeg', [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', outputPath,
    ], { timeout: 300_000 });
  } catch {
    await createPlaceholderVideo(outputPath, durationSec);
  }
}

async function createPlaceholderVideo(outputPath, durationSec) {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'color=c=0x059669:size=1920x1080:rate=30',
      '-t', String(durationSec), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', outputPath,
    ]);
  } catch {
    await fs.writeFile(outputPath, Buffer.alloc(0));
  }
}

async function mergeVideoAudio(videoPath, audioPath, outputPath) {
  const args = codex.buildFFmpegArgs(videoPath, audioPath, outputPath);
  try {
    await execFileAsync('ffmpeg', args, { timeout: 300_000 });
  } catch {
    await fs.copyFile(videoPath, outputPath).catch(() => {});
  }
}

async function uploadToDrive(filePath, sourceFolderId, driveConfig) {
  try {
    const drive = await getDriveClient(driveConfig);
    const outFolderId = driveConfig.outputFolderId || process.env.DRIVE_OUTPUT_FOLDER_ID || sourceFolderId;
    const res = await drive.files.create({
      requestBody: {
        name: `スライドショー動画_${new Date().toLocaleDateString('ja-JP')}.mp4`,
        mimeType: 'video/mp4',
        parents: [outFolderId],
      },
      media: { mimeType: 'video/mp4', body: require('fs').createReadStream(filePath) },
      fields: 'id,webViewLink',
    });
    return { fileId: res.data.id, webViewLink: res.data.webViewLink };
  } catch (err) {
    console.warn('[Pipeline②] Drive アップロード失敗:', err.message);
    return null;
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 80);
}

module.exports = driveToVideoPipeline;
