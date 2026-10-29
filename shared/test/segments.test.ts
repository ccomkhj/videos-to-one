import { describe, expect, it } from 'vitest';
import {
  initialSegments,
  keepRanges,
  keptDuration,
  resetSegments,
  splitAt,
  toggleRemoved,
  trimEnd,
  trimStart,
  validateSegments,
} from '../src/segments.ts';

describe('keep-range editing', () => {
  it('an unedited clip keeps one range covering the whole clip', () => {
    const segs = initialSegments(12.34);
    expect(keepRanges(segs)).toEqual([{ start: 0, end: 12.34 }]);
    expect(keptDuration(segs)).toBeCloseTo(12.34);
  });

  it('trimming moves the first start and the last end, snapped to 0.1 s', () => {
    let segs = initialSegments(10);
    segs = trimStart(segs, 1.234);
    segs = trimEnd(segs, 8.76, 10);
    expect(keepRanges(segs)).toEqual([{ start: 1.2, end: 8.8 }]);
  });

  it('trimming never leaves less than 1.0 s in the edge segment', () => {
    let segs = initialSegments(10);
    segs = trimStart(segs, 9.7);
    expect(keepRanges(segs)).toEqual([{ start: 9, end: 10 }]);
    segs = trimEnd(initialSegments(10), 0.3, 10);
    expect(keepRanges(segs)).toEqual([{ start: 0, end: 1 }]);
  });

  it('trimming the end never goes past the clip duration', () => {
    const segs = trimEnd(initialSegments(10), 99, 10);
    expect(keepRanges(segs)).toEqual([{ start: 0, end: 10 }]);
  });

  it('split + remove drops a middle part and leaves two keep ranges', () => {
    let segs = initialSegments(10);
    segs = splitAt(segs, 3);
    segs = splitAt(segs, 6.04);
    expect(segs).toHaveLength(3);
    segs = toggleRemoved(segs, 1);
    expect(keepRanges(segs)).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 10 },
    ]);
    expect(keptDuration(segs)).toBeCloseTo(7);
  });

  it('restoring a removed part merges it back into one continuous range', () => {
    let segs = splitAt(initialSegments(10), 5);
    segs = toggleRemoved(segs, 0);
    segs = toggleRemoved(segs, 0);
    expect(keepRanges(segs)).toEqual([{ start: 0, end: 10 }]);
  });

  it('refuses a split that would make a part shorter than 1.0 s', () => {
    const segs = initialSegments(10);
    expect(splitAt(segs, 0.5)).toBe(segs);
    expect(splitAt(segs, 9.6)).toBe(segs);
  });

  it('refuses to remove the last kept part', () => {
    const segs = splitAt(initialSegments(10), 5);
    const one = toggleRemoved(segs, 0);
    expect(toggleRemoved(one, 1)).toBe(one);
  });

  it('trimming the start past a removed part keeps the remaining parts in place', () => {
    let segs = splitAt(splitAt(initialSegments(10), 3), 6);
    segs = toggleRemoved(segs, 1);
    segs = trimStart(segs, 1);
    expect(keepRanges(segs)).toEqual([
      { start: 1, end: 3 },
      { start: 6, end: 10 },
    ]);
  });

  it('reset restores the full clip', () => {
    const segs = toggleRemoved(splitAt(initialSegments(10), 5), 0);
    expect(keepRanges(resetSegments(10))).toEqual([{ start: 0, end: 10 }]);
    expect(keepRanges(segs)).toEqual([{ start: 5, end: 10 }]);
  });

  it('validates segment lists sent by clients', () => {
    expect(validateSegments(initialSegments(10), 10)).toBeNull();
    expect(validateSegments([], 10)).toMatch(/at least one/);
    expect(validateSegments([{ start: 0, end: 11, removed: false }], 10)).toMatch(/duration/);
    expect(
      validateSegments(
        [
          { start: 0, end: 4, removed: false },
          { start: 5, end: 10, removed: false },
        ],
        10,
      ),
    ).toMatch(/contiguous/);
    expect(validateSegments([{ start: 0, end: 0.5, removed: false }], 10)).toMatch(/1\.0 s/);
    expect(validateSegments([{ start: 0, end: 10, removed: true }], 10)).toMatch(/kept/);
  });
});
