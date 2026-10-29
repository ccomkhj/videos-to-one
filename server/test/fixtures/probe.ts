/** Trimmed ffprobe `-show_format -show_streams` output, shaped like real files. */

export const iphonePortraitHdr = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      avg_frame_rate: '30/1',
      r_frame_rate: '30/1',
      color_transfer: 'arib-std-b67',
      color_primaries: 'bt2020',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
      tags: { creation_time: '2026-10-29T05:32:10.000000Z' },
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: {
    duration: '12.345000',
    tags: {
      creation_time: '2026-10-29T05:32:10.000000Z',
      'com.apple.quicktime.creationdate': '2026-10-29T14:32:10+0900',
      'com.apple.quicktime.location.ISO6709': '+35.0116+135.7681+040.000/',
      'com.apple.quicktime.make': 'Apple',
    },
  },
};

export const androidLandscape = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '30000/1001',
      r_frame_rate: '30/1',
      tags: { rotate: '0' },
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: {
    duration: '8.000000',
    tags: { creation_time: '2026-07-14T10:00:00.000000Z', location: '+48.8584+002.2945/' },
  },
};

export const noTags = {
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '25/1' }],
  format: { duration: '5.000000', tags: {} },
};

export const rotatedByTagNoAudio = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '0/0',
      r_frame_rate: '60/1',
      tags: { rotate: '90' },
    },
  ],
  format: { duration: '3.5', tags: { creation_time: '2026-01-01T23:30:00.000000Z' } },
};

export const audioOnly = {
  streams: [{ codec_type: 'audio', codec_name: 'aac' }],
  format: { duration: '3.0', tags: {} },
};
