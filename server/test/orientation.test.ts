import { describe, expect, it } from 'vitest';
import { cnnFramesArgs, decide, faceFramesArgs } from '../src/orientation.ts';

const upright = [0.92, 0.03, 0.03, 0.02];
const sideways = [0.03, 0.92, 0.03, 0.02];

describe('decide', () => {
  it('trusts faces when one rotation clearly has the most', () => {
    expect(decide([1, 4, 1, 1], Array(6).fill(upright))).toEqual({ suggested: 90, source: 'faces', confidence: 0.57 });
    expect(decide([5, 1, 0, 0], Array(6).fill(sideways))).toEqual({ suggested: 0, source: 'faces', confidence: 0.83 });
  });

  it('ignores faces that are too few or not twice as common as the runner-up', () => {
    // Upside-down faces often still detect, so 0° and 180° tie: the CNN decides.
    expect(decide([6, 2, 6, 1], Array(6).fill(upright))).toEqual({ suggested: 0, source: 'model', confidence: 0.92 });
    expect(decide([1, 6, 2, 6], Array(6).fill(sideways))).toEqual({ suggested: 90, source: 'model', confidence: 0.92 });
    expect(decide([0, 1, 0, 0], Array(6).fill(upright)).source).toBe('model');
  });

  it('suggests a CNN rotation only when confident and consistent across frames', () => {
    const left = [0.03, 0.03, 0.17, 0.77];
    expect(decide([0, 0, 0, 0], Array(6).fill(left))).toEqual({ suggested: 270, source: 'model', confidence: 0.77 });
    // Mean below 0.7.
    expect(decide([0, 0, 0, 0], Array(6).fill([0.35, 0.6, 0.03, 0.02])).suggested).toBe(0);
    // Confident on average, but only 3 of 6 frames agree.
    const mixed = [...Array(3).fill([0, 1, 0, 0]), ...Array(3).fill([0.5, 0.4, 0.1, 0])];
    expect(decide([0, 0, 0, 0], mixed).suggested).toBe(0);
    expect(decide([0, 0, 0, 0], [...mixed.slice(0, 4), [0, 1, 0, 0], [0.5, 0.4, 0.1, 0]]).suggested).toBe(90);
  });
});

describe('frame sampling', () => {
  it('reads six frames and turns each four ways for the face detector', () => {
    expect(faceFramesArgs('/c/proxy.mp4', 12)).toMatchSnapshot();
  });

  it('squashes and center-crops for the CNN', () => {
    expect(cnnFramesArgs('/c/proxy.mp4', 12)).toMatchSnapshot();
  });
});
