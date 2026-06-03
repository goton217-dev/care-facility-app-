import React from 'react';
import { Composition } from 'remotion';
import { FacilityVideo, FacilityVideoProps } from './FacilityVideo';
import { SNSShort, SNSShortProps } from './SNSShort';
import { DriveSlideshow, DriveSlideshowProps } from './DriveSlideshow';

export const Root: React.FC = () => (
  <>
    <Composition
      id="FacilityVideo"
      component={FacilityVideo}
      durationInFrames={1800}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        facilityName: '〇〇介護施設',
        facilityType: '介護付き有料老人ホーム',
        address: '東京都新宿区〇〇1-2-3',
        visitDate: '2024-01-15',
        accentColor: '#2563eb',
        logoText: '見守りノート',
      } satisfies FacilityVideoProps}
    />

    <Composition
      id="SNSShort"
      component={SNSShort}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        facilityName: '〇〇介護施設',
        facilityType: '特別養護老人ホーム',
        accentColor: '#7c3aed',
        style: 'modern-gradient',
      } satisfies SNSShortProps}
    />

    <Composition
      id="DriveSlideshow"
      component={DriveSlideshow}
      durationInFrames={2700}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        slides: [{ index: 0, fileId: 'demo', fileName: 'demo.jpg', mimeType: 'image/jpeg' }],
        narration: 'サンプルナレーション',
        accentColor: '#059669',
        transitionStyle: 'fade',
      } satisfies DriveSlideshowProps}
    />
  </>
);
