'use strict';
/**
 * Antigravity CODEX v1.0
 * Core framework — prompt templates, composition specs, generation rules
 * for the 4-pipeline content engine.
 */

const NARRATION_STYLES = {
  'professional-warm': {
    tone: '専門的かつ温かみのある語り口',
    pace: 'ゆっくり落ち着いて',
    person: '丁寧語・敬語',
  },
  'energetic-brief': {
    tone: '活発で簡潔、SNS向け',
    pace: '明るくテンポよく',
    person: 'フレンドリーな語り口',
  },
  'neutral-informative': {
    tone: '中立的で情報重視',
    pace: '標準的なペース',
    person: '普通語',
  },
};

const EVAL_LABELS = {
  insulin: 'インシュリン対応',
  monthly_fee: '月額費用',
  initial_fee: '入居金・初期費用',
  insurance_extra: '介護保険外料金',
  atmosphere: '見学時の雰囲気',
  staff: '職員の対応',
  vacancy: '空き状況',
  medical: '医療体制',
  meal: '食事内容',
  outing: '外出・面会制限',
  care_manager: 'ケアマネ選択',
  move_out: '退去の要件',
};

class AntigravityCodex {
  constructor() {
    this.version = '1.0.0';
    this.rules = {
      maxVideoDuration: 120,
      supportedOutputFormats: ['mp4'],
      defaultAudioBitrate: '128k',
      defaultVideoBitrate: '4000k',
      audioCodec: 'aac',
      videoCodec: 'libx264',
    };
  }

  // ── Pipeline ① テンプレート ─────────────────────────────
  facilityVideoPrompt(facility, evaluations = []) {
    const style = NARRATION_STYLES['professional-warm'];
    const evalSummary = evaluations.length
      ? evaluations
          .map(e => `  - ${EVAL_LABELS[e.item_key] || e.item_key}: ${e.rating ? '★'.repeat(e.rating) : '未評価'}${e.note ? ` (${e.note})` : ''}`)
          .join('\n')
      : '  （評価データなし）';

    return `あなたは介護施設紹介動画のナレーションライターです。
スタイル: ${style.tone}、${style.pace}、${style.person}

以下の施設情報をもとに、60秒程度（約250文字）の紹介ナレーション原稿を作成してください。
視聴者はご家族（50〜70代）です。

【施設情報】
施設名: ${facility.name}
種別: ${facility.facility_type || '未設定'}
住所: ${facility.address || '未設定'}
電話: ${facility.phone || '未設定'}
見学日: ${facility.visit_date || '未設定'}

【評価データ】
${evalSummary}

要件:
- 施設の魅力を具体的に伝える
- 専門用語は平易な言葉で補足する
- 家族の安心感を最優先に
- 文章のみ（ト書き・記号は不要）
- 日本語で出力`;
  }

  facilityVideoCompositionSpec(facility) {
    return {
      type: 'FacilityVideo',
      durationInFrames: 1800, // 60s @ 30fps
      fps: 30,
      width: 1920,
      height: 1080,
      data: {
        facilityName: facility.name,
        facilityType: facility.facility_type || '',
        address: facility.address || '',
        visitDate: facility.visit_date || '',
        accentColor: '#2563eb',
        logoText: '見守りノート',
      },
    };
  }

  // ── Pipeline ④ SNS テンプレート ────────────────────────
  snsVideoPrompt(facility, evaluations = []) {
    const style = NARRATION_STYLES['energetic-brief'];
    const topEvals = evaluations
      .filter(e => e.rating && e.rating >= 4)
      .slice(0, 3)
      .map(e => EVAL_LABELS[e.item_key] || e.item_key);

    return `あなたはSNS動画（TikTok・Instagram Reels）向けの介護施設紹介コピーライターです。
スタイル: ${style.tone}、${style.pace}

以下の施設について30秒（約100文字）の短尺動画ナレーションを作成してください。

【施設名】${facility.name}（${facility.facility_type || '介護施設'}）
【強み】${topEvals.length ? topEvals.join('・') : '専門スタッフによる安心サポート'}

要件:
- 冒頭5秒で視聴者を引きつける一言から始める
- 具体的な数字や事実を入れる（なければ一般的な事例）
- #ハッシュタグ を3つ末尾に追加
- 日本語で出力`;
  }

  snsVideoCompositionSpec(facility) {
    return {
      type: 'SNSShort',
      durationInFrames: 900, // 30s @ 30fps
      fps: 30,
      width: 1080,
      height: 1920, // 9:16 縦型
      data: {
        facilityName: facility.name,
        facilityType: facility.facility_type || '介護施設',
        accentColor: '#7c3aed',
        style: 'modern-gradient',
      },
    };
  }

  // ── Pipeline ② Drive スライドショー ────────────────────
  driveVideoCompositionSpec(files, narration = '') {
    const perSlide = Math.max(3, Math.floor(90 / Math.max(1, files.length)));
    return {
      type: 'DriveSlideshow',
      durationInFrames: files.length * perSlide * 30,
      fps: 30,
      width: 1920,
      height: 1080,
      data: {
        slides: files.map((f, i) => ({
          index: i,
          fileId: f.id,
          fileName: f.name,
          mimeType: f.mimeType,
        })),
        narration,
        accentColor: '#059669',
        transitionStyle: 'fade',
      },
    };
  }

  driveNarrationPrompt(files) {
    const fileList = files.map(f => `  - ${f.name}`).join('\n');
    return `以下のファイル群のスライドショー動画用ナレーションを作成してください。
各スライドを自然につなげて、90秒程度（約380文字）で説明してください。

【ファイル一覧】
${fileList}

要件:
- 介護施設・ケア関連の文脈で説明
- 自然な話し言葉
- 日本語で出力`;
  }

  // ── Pipeline ③ コード自動生成 プロンプト ──────────────
  codegenPrompt(task, context = {}) {
    return `Claude Code CLI コード生成タスク

タスク: ${task}
リポジトリ: ${context.repo || 'care-facility-app-'}
ブランチ: ${context.branch || 'main'}
実行者: Claude Code Desktop Dispatch

要件:
- 既存のコードスタイルに合わせる
- Node.js/Express 環境
- テスト可能なコードを生成
- 変更後にgit commitメッセージを提案`;
  }

  // ── ユーティリティ ──────────────────────────────────────
  validateJobConfig(type, config) {
    const required = {
      facilityVideo: ['facilityId'],
      driveToVideo: ['folderId'],
      codeAutogen: ['task'],
      snsContent: ['facilityIds'],
    };
    const missing = (required[type] || []).filter(k => !config[k]);
    if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
    return true;
  }

  buildFFmpegArgs(videoPath, audioPath, outputPath, options = {}) {
    return [
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', options.videoCodec || this.rules.videoCodec,
      '-c:a', options.audioCodec || this.rules.audioCodec,
      '-b:a', options.audioBitrate || this.rules.defaultAudioBitrate,
      '-shortest',
      '-y',
      outputPath,
    ];
  }
}

module.exports = new AntigravityCodex();
