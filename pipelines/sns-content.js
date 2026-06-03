'use strict';
/**
 * Pipeline ④ — SNSコンテンツ量産
 * 複数施設データ → Claude Script → Gemini TTS → Remotion 縦型9:16 → FFMPEG → バッチMP4 → Drive
 */

const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const Anthropic = require('@anthropic-ai/sdk');
const codex = require('./antigravity-codex');

const anthropic = new Anthropic();

async function snsContentPipeline(config, progress) {
  const {
    facilityIds,
    pool,
    outputDir = '/tmp/pipeline-output',
    driveConfig = {},
    maxConcurrent = 3,
  } = config;

  if (!Array.isArray(facilityIds) || !facilityIds.length) {
    throw new Error('facilityIds は1件以上必要です');
  }

  const jobDir = path.join(outputDir, `sns-content-${Date.now()}`);
  await fs.mkdir(jobDir, { recursive: true });

  // Step 1: 施設データを一括取得
  progress(`${facilityIds.length}件の施設データを取得中`, 5);
  const facilities = await fetchFacilities(facilityIds, pool);
  const facilityEvals = await fetchFacilityEvaluations(facilityIds, pool);

  // Step 2: バッチでSNSスクリプト生成（Claude）
  progress('Claude がSNSスクリプトを一括生成中', 20);
  const scripts = await generateBatchScripts(facilities, facilityEvals);
  await fs.writeFile(
    path.join(jobDir, 'scripts.json'),
    JSON.stringify(scripts, null, 2),
    'utf8'
  );

  // Step 3: Gemini TTS バッチ音声生成
  progress('Gemini TTS で音声を一括生成中', 40);
  const audioFiles = await generateBatchAudio(scripts, jobDir);

  // Step 4: Remotion で縦型動画をバッチレンダリング
  progress('Remotion で縦型SNS動画をレンダリング中', 60);
  const videoFiles = await renderBatchVideos(facilities, scripts, audioFiles, jobDir);

  // Step 5: FFMPEG で各動画に音声を合成
  progress('FFMPEG で動画を合成中', 78);
  const finalVideos = await mergeBatchVideos(videoFiles, audioFiles, jobDir);

  // Step 6: Drive にバッチアップロード
  progress('Google Drive にバッチアップロード中', 90);
  const uploadResults = await uploadBatchToDrive(finalVideos, driveConfig);

  // Step 7: サマリーレポート生成
  progress('レポートを生成中', 97);
  const report = buildReport(facilities, scripts, finalVideos, uploadResults);
  await fs.writeFile(path.join(jobDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  progress('完了', 100);
  return report;
}

// ── DB Fetching ────────────────────────────────────────────
async function fetchFacilities(ids, pool) {
  const { rows } = await pool.query(
    `SELECT * FROM facilities WHERE id = ANY($1::int[]) ORDER BY id`,
    [ids]
  );
  return rows;
}

async function fetchFacilityEvaluations(ids, pool) {
  const { rows } = await pool.query(
    `SELECT e.* FROM evaluations e WHERE e.facility_id = ANY($1::int[])`,
    [ids]
  );
  const byFacility = {};
  for (const e of rows) {
    if (!byFacility[e.facility_id]) byFacility[e.facility_id] = [];
    byFacility[e.facility_id].push(e);
  }
  return byFacility;
}

// ── Claude バッチスクリプト生成 ────────────────────────────
async function generateBatchScripts(facilities, evalsByFacility) {
  const scripts = [];

  // 並列上限3でバッチ処理
  const BATCH = 3;
  for (let i = 0; i < facilities.length; i += BATCH) {
    const batch = facilities.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (facility) => {
        const evals = evalsByFacility[facility.id] || [];
        const prompt = codex.snsVideoPrompt(facility, evals);
        try {
          const res = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          });
          const text = res.content.find(b => b.type === 'text')?.text || '';
          return { facilityId: facility.id, facilityName: facility.name, script: text, ok: true };
        } catch (err) {
          return { facilityId: facility.id, facilityName: facility.name, script: '', error: err.message, ok: false };
        }
      })
    );
    scripts.push(...batchResults);
  }
  return scripts;
}

// ── Gemini TTS バッチ ──────────────────────────────────────
async function generateBatchAudio(scripts, jobDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  const audioDir = path.join(jobDir, 'audio');
  await fs.mkdir(audioDir, { recursive: true });

  const results = [];
  for (const s of scripts) {
    const audioPath = path.join(audioDir, `facility-${s.facilityId}.mp3`);
    if (apiKey && s.script) {
      try {
        await generateGeminiTTS(s.script, audioPath, apiKey);
        results.push({ facilityId: s.facilityId, audioPath, ok: true });
        continue;
      } catch (err) {
        console.warn(`[Pipeline④] TTS失敗 ${s.facilityName}:`, err.message);
      }
    }
    // Fallback: 無音
    await createSilentAudio(audioPath, 30);
    results.push({ facilityId: s.facilityId, audioPath, ok: false });
  }
  return results;
}

async function generateGeminiTTS(text, outputPath, apiKey) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-tts' });

  const result = await model.generateContent({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }, // 明るい声
      },
    },
  });

  const audioData = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error('TTS音声データ取得失敗');
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

// ── Remotion バッチレンダリング ────────────────────────────
async function renderBatchVideos(facilities, scripts, audioFiles, jobDir) {
  const videoDir = path.join(jobDir, 'videos-raw');
  await fs.mkdir(videoDir, { recursive: true });

  const remotionDir = path.join(__dirname, '..', 'remotion');
  const remotionExists = await fs.access(remotionDir).then(() => true).catch(() => false);

  const results = [];
  for (const facility of facilities) {
    const spec = codex.snsVideoCompositionSpec(facility);
    const videoPath = path.join(videoDir, `facility-${facility.id}-raw.mp4`);
    const specPath = path.join(videoDir, `facility-${facility.id}-spec.json`);
    await fs.writeFile(specPath, JSON.stringify(spec, null, 2));

    if (remotionExists) {
      try {
        await execFileAsync('npx', [
          'remotion', 'render',
          '--composition', spec.type,
          '--props', specPath,
          '--output', videoPath,
        ], { cwd: remotionDir, timeout: 300_000 });
        results.push({ facilityId: facility.id, videoPath, ok: true });
        continue;
      } catch (err) {
        console.warn(`[Pipeline④] Remotion失敗 ${facility.name}:`, err.message);
      }
    }

    // フォールバック: 縦型グラデーション動画
    await createSNSPlaceholderVideo(videoPath, facility, spec);
    results.push({ facilityId: facility.id, videoPath, ok: false });
  }
  return results;
}

async function createSNSPlaceholderVideo(outputPath, facility, spec) {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi',
      '-i', `color=c=0x7c3aed:size=1080x1920:rate=30`,
      '-vf', [
        `drawtext=text='${facility.name}':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-100`,
        `drawtext=text='${facility.facility_type || '介護施設'}':fontsize=36:fontcolor=white@0.8:x=(w-text_w)/2:y=(h-text_h)/2+40`,
      ].join(','),
      '-t', String(spec.durationInFrames / spec.fps),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', outputPath,
    ]);
  } catch {
    await fs.writeFile(outputPath, Buffer.alloc(0));
  }
}

// ── FFMPEG バッチ合成 ──────────────────────────────────────
async function mergeBatchVideos(videoFiles, audioFiles, jobDir) {
  const finalDir = path.join(jobDir, 'final');
  await fs.mkdir(finalDir, { recursive: true });

  const audioMap = Object.fromEntries(audioFiles.map(a => [a.facilityId, a.audioPath]));
  const results = [];

  for (const v of videoFiles) {
    const audioPath = audioMap[v.facilityId];
    const finalPath = path.join(finalDir, `sns-${v.facilityId}.mp4`);
    const args = codex.buildFFmpegArgs(v.videoPath, audioPath, finalPath);

    try {
      await execFileAsync('ffmpeg', args, { timeout: 180_000 });
      results.push({ facilityId: v.facilityId, finalPath, size: await getFileSize(finalPath) });
    } catch {
      await fs.copyFile(v.videoPath, finalPath).catch(() => {});
      results.push({ facilityId: v.facilityId, finalPath, size: 0 });
    }
  }
  return results;
}

// ── Drive バッチアップロード ───────────────────────────────
async function uploadBatchToDrive(finalVideos, driveConfig) {
  const folderId = driveConfig.snsFolderId || process.env.DRIVE_SNS_FOLDER_ID;
  if (!folderId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn('[Pipeline④] Drive 認証情報未設定 — アップロードをスキップ');
    return finalVideos.map(v => ({ ...v, driveFileId: null }));
  }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const results = [];
  for (const v of finalVideos) {
    try {
      const res = await drive.files.create({
        requestBody: {
          name: `SNS動画_施設${v.facilityId}_${new Date().toLocaleDateString('ja-JP')}.mp4`,
          mimeType: 'video/mp4',
          parents: folderId ? [folderId] : undefined,
        },
        media: {
          mimeType: 'video/mp4',
          body: require('fs').createReadStream(v.finalPath),
        },
        fields: 'id,webViewLink',
      });
      results.push({ ...v, driveFileId: res.data.id, driveUrl: res.data.webViewLink });
    } catch (err) {
      console.warn(`[Pipeline④] Drive アップロード失敗 facility-${v.facilityId}:`, err.message);
      results.push({ ...v, driveFileId: null });
    }
  }
  return results;
}

// ── Utils ──────────────────────────────────────────────────
async function getFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

function buildReport(facilities, scripts, finalVideos, uploadResults) {
  const facilityMap = Object.fromEntries(facilities.map(f => [f.id, f]));
  const scriptMap = Object.fromEntries(scripts.map(s => [s.facilityId, s]));
  const uploadMap = Object.fromEntries(uploadResults.map(u => [u.facilityId, u]));

  return {
    generatedAt: new Date().toISOString(),
    totalFacilities: facilities.length,
    totalVideos: finalVideos.length,
    uploadedToDrive: uploadResults.filter(u => u.driveFileId).length,
    items: facilities.map(f => ({
      facilityId: f.id,
      facilityName: f.name,
      facilityType: f.facility_type,
      script: scriptMap[f.id]?.script || '',
      scriptOk: scriptMap[f.id]?.ok || false,
      localPath: uploadMap[f.id]?.finalPath,
      fileSize: uploadMap[f.id]?.size,
      driveFileId: uploadMap[f.id]?.driveFileId,
      driveUrl: uploadMap[f.id]?.driveUrl,
    })),
  };
}

module.exports = snsContentPipeline;
