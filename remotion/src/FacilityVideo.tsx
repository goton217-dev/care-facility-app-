/**
 * Pipeline ① — 施設紹介動画コンポジション (1920×1080 横型)
 */
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';

export interface FacilityVideoProps {
  facilityName: string;
  facilityType: string;
  address: string;
  visitDate: string;
  accentColor: string;
  logoText: string;
}

export const FacilityVideo: React.FC<FacilityVideoProps> = ({
  facilityName,
  facilityType,
  address,
  visitDate,
  accentColor,
  logoText,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // フェードイン/アウト
  const opacity = interpolate(
    frame,
    [0, 30, durationInFrames - 30, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const titleScale = spring({ frame, fps, config: { damping: 12 } });
  const subtitleY = spring({ frame: frame - 20, fps, config: { damping: 14 } });

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#0f172a' }}>
      {/* 背景グラデーション */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, ${accentColor}33 0%, #0f172a 60%)`,
        }}
      />

      {/* アクセントライン */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${interpolate(frame, [0, 60], [0, 100], { extrapolateRight: 'clamp' })}%`,
          height: 6,
          backgroundColor: accentColor,
        }}
      />

      {/* ロゴ */}
      <div
        style={{
          position: 'absolute',
          top: 48,
          left: 80,
          color: '#ffffff80',
          fontSize: 24,
          fontFamily: 'sans-serif',
          letterSpacing: 4,
        }}
      >
        {logoText}
      </div>

      {/* メインコンテンツ */}
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '0 120px',
        }}
      >
        {/* 施設種別 */}
        <div
          style={{
            color: accentColor,
            fontSize: 28,
            fontFamily: 'sans-serif',
            letterSpacing: 6,
            marginBottom: 24,
            transform: `translateY(${interpolate(subtitleY, [0, 1], [40, 0])}px)`,
            opacity: subtitleY,
          }}
        >
          {facilityType}
        </div>

        {/* 施設名 */}
        <div
          style={{
            color: '#ffffff',
            fontSize: 84,
            fontFamily: 'sans-serif',
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -1,
            transform: `scale(${interpolate(titleScale, [0, 1], [0.8, 1])})`,
            transformOrigin: 'left center',
          }}
        >
          {facilityName}
        </div>

        {/* 詳細情報 */}
        <Sequence from={45}>
          <div
            style={{
              marginTop: 48,
              color: '#94a3b8',
              fontSize: 28,
              fontFamily: 'sans-serif',
              lineHeight: 2,
              opacity: interpolate(frame - 45, [0, 20], [0, 1], { extrapolateRight: 'clamp' }),
            }}
          >
            <div>📍 {address}</div>
            {visitDate && <div>🗓 見学日: {visitDate}</div>}
          </div>
        </Sequence>
      </AbsoluteFill>

      {/* 下部ボーダー */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, ${accentColor}, transparent)`,
        }}
      />
    </AbsoluteFill>
  );
};
