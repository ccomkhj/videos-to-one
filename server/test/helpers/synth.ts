/** Synthetic test clips made with ffmpeg (SPEC §9 "Integration"). */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

export interface SynthClip {
  file: string;
  name: string;
}

export function makeClips(dir: string): Record<'paris' | 'kyoto' | 'rotatedNoMeta', SynthClip> {
  // Landscape, Android-style tags (UTC creation_time + ©xyz location), with audio.
  const paris = path.join(dir, 'paris.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4',
    '-f', 'lavfi', '-i', 'sine=f=440:d=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-metadata', 'creation_time=2026-07-14T10:00:00Z',
    '-metadata', 'location=+48.8584+002.2945/',
    paris,
  ]);
  // Portrait, iPhone-style QuickTime tags, 60 fps, no audio. Recorded a day earlier.
  const kyoto = path.join(dir, 'kyoto.mov');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=60:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-movflags', 'use_metadata_tags',
    '-metadata', 'com.apple.quicktime.creationdate=2026-07-13T09:00:00+0900',
    '-metadata', 'com.apple.quicktime.location.ISO6709=+35.0116+135.7681+040.000/',
    kyoto,
  ]);
  // Landscape pixels with a 90° display matrix (shows as portrait), no metadata.
  const tmp = path.join(dir, 'tmp.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3',
    '-f', 'lavfi', '-i', 'sine=f=220:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-map_metadata', '-1', '-fflags', '+bitexact',
    tmp,
  ]);
  const rotated = path.join(dir, 'rotated.mp4');
  ff(['-display_rotation', '90', '-i', tmp, '-c', 'copy', '-map_metadata', '-1', rotated]);

  return {
    paris: { file: paris, name: 'paris.mp4' },
    kyoto: { file: kyoto, name: 'IMG_0001.MOV' },
    rotatedNoMeta: { file: rotated, name: 'rotated.mp4' },
  };
}

export function ffprobeJson(file: string): any {
  return JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString(),
  );
}
