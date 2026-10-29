import { describe, expect, it } from 'vitest';
import { formatDate, formatDateRange } from '@vto/shared';
import { parseLocation, parseProbe } from '../src/metadata.ts';
import { androidLandscape, audioOnly, iphonePortraitHdr, noTags, rotatedByTagNoAudio } from './fixtures/probe.ts';

const tzForParis = () => 'Europe/Paris';
const noTz = () => undefined;

describe('parseProbe', () => {
  it('reads an iPhone HDR portrait clip: rotation, HDR, local time with offset, ISO6709 location', () => {
    const r = parseProbe(iphonePortraitHdr, { fallbackTz: 'UTC', tzAt: noTz });
    expect(r.media).toMatchObject({
      duration: 12.345,
      width: 2160,
      height: 3840,
      rotation: 90,
      fps: 30,
      hdr: true,
      colorTransfer: 'arib-std-b67',
      hasAudio: true,
      videoCodec: 'hevc',
    });
    expect(r.recordedAt).toEqual({
      local: '2026-10-29T14:32:10',
      utcMs: Date.UTC(2026, 9, 29, 5, 32, 10),
      source: 'quicktime',
    });
    expect(r.location).toEqual({ lat: 35.0116, lon: 135.7681 });
  });

  it('converts UTC creation_time to local time at the GPS position for Android-style files', () => {
    const r = parseProbe(androidLandscape, { fallbackTz: 'Asia/Seoul', tzAt: tzForParis });
    expect(r.media.fps).toBeCloseTo(29.97, 2);
    expect(r.media.width).toBe(1920);
    expect(r.location).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(r.recordedAt).toMatchObject({ local: '2026-07-14T12:00:00', source: 'creation_time+gps' });
  });

  it('falls back to the container TZ when the clip has no GPS', () => {
    const r = parseProbe(rotatedByTagNoAudio, { fallbackTz: 'Europe/Berlin', tzAt: noTz });
    expect(r.recordedAt).toMatchObject({ local: '2026-01-02T00:30:00', source: 'creation_time+tz' });
    expect(r.media).toMatchObject({ width: 1080, height: 1920, rotation: 90, fps: 60, hasAudio: false, hdr: false });
  });

  it('uses the browser lastModified only when nothing else exists', () => {
    const lastModified = Date.UTC(2026, 4, 1, 8, 0, 0);
    const r = parseProbe(noTags, { fallbackTz: 'Asia/Tokyo', tzAt: noTz, lastModified });
    expect(r.recordedAt).toEqual({ local: '2026-05-01T17:00:00', utcMs: lastModified, source: 'lastModified' });
    expect(r.location).toBeUndefined();
  });

  it('has no date and no location when there is no metadata at all', () => {
    const r = parseProbe(noTags, { fallbackTz: 'UTC', tzAt: noTz });
    expect(r.recordedAt).toBeUndefined();
    expect(r.location).toBeUndefined();
  });

  it('rejects files without a video stream', () => {
    expect(() => parseProbe(audioOnly, { fallbackTz: 'UTC', tzAt: noTz })).toThrow(/no video stream/);
  });
});

describe('parseLocation', () => {
  it('parses ISO 6709 with and without altitude', () => {
    expect(parseLocation('-33.8688+151.2093/')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseLocation('+40.6892-074.0445+010.000/')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseLocation('garbage')).toBeUndefined();
    expect(parseLocation('+95.0+010.0/')).toBeUndefined();
  });
});

describe('date labels', () => {
  it('formats a single date as "29 Oct 2026"', () => {
    expect(formatDate('2026-10-29T14:32:10')).toBe('29 Oct 2026');
    expect(formatDate('2026-03-05T00:00:00')).toBe('5 Mar 2026');
  });

  it('formats date ranges compactly', () => {
    expect(formatDateRange(['2026-10-18T09:00:00', '2026-10-12T10:00:00'])).toBe('12 – 18 Oct 2026');
    expect(formatDateRange(['2026-09-28T09:00:00', '2026-10-03T10:00:00'])).toBe('28 Sep – 3 Oct 2026');
    expect(formatDateRange(['2025-12-28T09:00:00', '2026-01-03T10:00:00'])).toBe('28 Dec 2025 – 3 Jan 2026');
    expect(formatDateRange(['2026-10-12T09:00:00', '2026-10-12T18:00:00'])).toBe('12 Oct 2026');
    expect(formatDateRange([])).toBeNull();
  });
});
