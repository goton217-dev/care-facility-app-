/**
 * Pipeline ④ — SNS縦型動画コンポジション (1080×1920 9:16)
 */
import React from 'react';
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';

export interface SNSShortProps {
  facilityName: string;
  facilityType: string;
  accentColor: string;
  style: 'modern-gradient' | 'minimal' | 'bold';
}

export const SNSShort: React.FC<SNSShortProps> = ({
  facilityName,
  facilityType,
  accentColor,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const titleSpring = spring({ frame, fps, config: { damping: 10, stiffness: 80 } });
  const badgeSpring = spring({ frame: frame - 15, fps, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#1e1b4b' }}>
      {/* 背景グラデーション */}
      <AbsoluteFill
        style={{
          background: style === 'modern-gradient'
            ? `linear-gradient(160deg, ${accentColor} 0%, #1e1b4b 50%, #0f172a 100%)`
            : `radial-gradient(circle at 30% 30%, ${accentColor}66, #0f172a)`,
        }}
      />

      {/* デコレーション円 */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          right: -200,
          width: 700,
          height: 700,
          borderRadius: '50%',
          border: `3px solid ${accentColor}44`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -150,
          left: -150,
          width: 500,
          height: 500,
          borderRadius: '50%',
          border: `2px solid ${accentColor}33`,
        }}
      />

      {/* コンテンツ */}
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 80px',
          textAlign: 'center',
        }}
      >
        {/* 施設種別バッジ */}
        <div
          style={{
            backgroundColor: `${accentColor}33`,
            border: `1px solid ${accentColor}`,
            color: '#e0e7ff',
            fontSize: 28,
            fontFamily: 'sans-serif',
            padding: '12px 32px',
            borderRadius: 999,
            marginBottom: 48,
            letterSpacing: 4,
            transform: `translateY(${interpolate(badgeSpring, [0, 1], [30, 0])}px)`,
            opacity: badgeSpring,
          }}
        >
          {facilityType}
        </div>

        {/* 施設名 */}
        <div
          style={{
            color: '#ffffff',
            fontSize: 72,
            fontFamily: 'sans-serif',
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: -1,
            transform: `scale(${interpolate(titleSpring, [0, 1], [0.7, 1])})`,
          }}
        >
          {facilityName}
        </div>

        {/* パルスアニメーション (CTA) */}
        <div
          style={{
            marginTop: 64,
            color: accentColor,
            fontSize: 32,
            fontFamily: 'sans-serif',
            fontWeight: 700,
            letterSpacing: 2,
            opacity: 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2),
          }}
        >
          ▶ 詳細を見る
        </div>
      </AbsoluteFill>

      {/* 下部ウォーターマーク */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: '#ffffff44',
          fontSize: 22,
          fontFamily: 'sans-serif',
          letterSpacing: 6,
        }}
      >
        見守りノート
      </div>
    </AbsoluteFill>
  );
};
