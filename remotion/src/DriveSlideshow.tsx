/**
 * Pipeline ② — Drive スライドショーコンポジション (1920×1080)
 */
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Img,
  staticFile,
} from 'remotion';

export interface SlideItem {
  index: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  localPath?: string;
}

export interface DriveSlideshowProps {
  slides: SlideItem[];
  narration: string;
  accentColor: string;
  transitionStyle: 'fade' | 'slide' | 'zoom';
}

const SLIDE_DURATION_FRAMES = 90; // 3秒 @ 30fps

const Slide: React.FC<{
  slide: SlideItem;
  from: number;
  duration: number;
  accentColor: string;
  transitionStyle: string;
}> = ({ slide, from, duration, accentColor, transitionStyle }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - from;

  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = interpolate(
    localFrame,
    [0, 15, duration - 15, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const scale = transitionStyle === 'zoom'
    ? interpolate(localFrame, [0, duration], [1, 1.05])
    : 1;

  return (
    <Sequence from={from} durationInFrames={duration}>
      <AbsoluteFill style={{ opacity }}>
        <AbsoluteFill style={{ backgroundColor: '#0f172a' }} />

        {/* スライド画像（localPath がある場合） */}
        {slide.localPath ? (
          <Img
            src={slide.localPath}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${scale})`,
            }}
          />
        ) : (
          <AbsoluteFill
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(135deg, ${accentColor}22, #0f172a)`,
            }}
          >
            <div style={{ color: '#ffffff44', fontSize: 48, fontFamily: 'sans-serif' }}>
              {slide.fileName}
            </div>
          </AbsoluteFill>
        )}

        {/* スライド番号 */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 60,
            color: '#ffffff80',
            fontSize: 22,
            fontFamily: 'sans-serif',
          }}
        >
          {slide.index + 1}
        </div>

        {/* ファイル名キャプション */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '48px 80px 48px',
            background: 'linear-gradient(to top, #000000cc, transparent)',
            color: '#ffffff',
            fontSize: 28,
            fontFamily: 'sans-serif',
          }}
        >
          {slide.fileName}
        </div>
      </AbsoluteFill>
    </Sequence>
  );
};

export const DriveSlideshow: React.FC<DriveSlideshowProps> = ({
  slides,
  narration,
  accentColor,
  transitionStyle,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const slideDuration = Math.floor(durationInFrames / Math.max(1, slides.length));
  const titleOpacity = interpolate(frame, [0, 30], [1, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      {/* スライド */}
      {slides.map((slide, i) => (
        <Slide
          key={slide.fileId}
          slide={slide}
          from={i * slideDuration}
          duration={slideDuration}
          accentColor={accentColor}
          transitionStyle={transitionStyle}
        />
      ))}

      {/* タイトルオーバーレイ（冒頭のみ） */}
      <AbsoluteFill
        style={{
          opacity: titleOpacity,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${accentColor}cc`,
        }}
      >
        <div style={{ color: '#ffffff', fontSize: 64, fontFamily: 'sans-serif', fontWeight: 700 }}>
          施設ギャラリー
        </div>
      </AbsoluteFill>

      {/* アクセントバー */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 4,
          width: `${(frame / durationInFrames) * 100}%`,
          backgroundColor: accentColor,
          transition: 'width 0.1s linear',
        }}
      />
    </AbsoluteFill>
  );
};
