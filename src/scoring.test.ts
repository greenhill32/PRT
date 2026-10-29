import { describe, it, expect } from 'vitest';
import {
  eventPoints,
  composite,
  tierOf,
  gapToNextTier,
  navyScoring1_0
} from './scoring';

const ctx = navyScoring1_0;

describe('Scoring Module', () => {
  describe('eventPoints - Push-ups', () => {
    it('scores exactly at thresholds', () => {
      expect(eventPoints('pushups', 16, ctx)).toBe(60);
      expect(eventPoints('pushups', 38, ctx)).toBe(70);
      expect(eventPoints('pushups', 60, ctx)).toBe(100);
    });

    it('interpolates between thresholds', () => {
      // Between 38 (70) and 46 (75)
      const score = eventPoints('pushups', 42, ctx);
      expect(score).toBeGreaterThan(70);
      expect(score).toBeLessThan(75);
    });

    it('caps at 100', () => {
      expect(eventPoints('pushups', 100, ctx)).toBe(100);
    });

    it('scores below minimum (interpolates toward 0)', () => {
      const score0 = eventPoints('pushups', 0, ctx);
      const score8 = eventPoints('pushups', 8, ctx);
      expect(score0).toBeLessThanOrEqual(60);
      expect(score0).toBeGreaterThanOrEqual(0);
      expect(score8).toBeGreaterThan(score0);
      expect(score8).toBeLessThan(60);
    });
  });

  describe('eventPoints - Plank', () => {
    it('scores exactly at thresholds (seconds)', () => {
      expect(eventPoints('plank', 87, ctx)).toBe(60);   // 1:27
      expect(eventPoints('plank', 122, ctx)).toBe(70);  // 2:02
      expect(eventPoints('plank', 174, ctx)).toBe(100); // 2:54
    });

    it('interpolates between plank thresholds', () => {
      // Between 122 (70) and 139 (75)
      const score = eventPoints('plank', 130, ctx);
      expect(score).toBeGreaterThan(70);
      expect(score).toBeLessThan(75);
    });

    it('longer time = higher score for plank', () => {
      const score1 = eventPoints('plank', 120, ctx);
      const score2 = eventPoints('plank', 140, ctx);
      expect(score2).toBeGreaterThan(score1);
    });
  });

  describe('eventPoints - 2k Row', () => {
    it('scores exactly at thresholds (seconds)', () => {
      expect(eventPoints('row_2k', 570, ctx)).toBe(60);  // 9:30
      expect(eventPoints('row_2k', 530, ctx)).toBe(70);  // 8:50
      expect(eventPoints('row_2k', 460, ctx)).toBe(100); // 7:40
    });

    it('faster time = higher score', () => {
      const score1 = eventPoints('row_2k', 550, ctx);
      const score2 = eventPoints('row_2k', 500, ctx);
      expect(score2).toBeGreaterThan(score1);
    });
  });

  describe('composite', () => {
    it('calculates mean of three events', () => {
      const results = {
        pushups: 38,   // 70 points
        plank: 122,    // 70 points
        row_2k: 530    // 70 points
      };
      const score = composite(results, ctx);
      expect(score).toBe(70);
    });

    it('handles partial results', () => {
      const results = {
        pushups: 38,   // 70 points
        plank: 122     // 70 points
      };
      const score = composite(results, ctx);
      expect(score).toBe(70);
    });

    it('rounds to nearest integer', () => {
      const results = {
        pushups: 48,   // 80 points
        plank: 122,    // 70 points
        row_2k: 530    // 70 points
      };
      const score = composite(results, ctx);
      expect(score).toBe(73); // (80 + 70 + 70) / 3 = 73.33 → 73
    });

    it('returns 0 for empty results', () => {
      expect(composite({}, ctx)).toBe(0);
    });
  });

  describe('tierOf', () => {
    it('categorizes Outstanding (100)', () => {
      const tier = tierOf(100, ctx);
      expect(tier.category).toBe('Outstanding');
      expect(tier.pointsToNext).toBe(0);
    });

    it('categorizes Excellent (85-99)', () => {
      const tier = tierOf(90, ctx);
      expect(tier.category).toBe('Excellent');
    });

    it('categorizes Good (70-84)', () => {
      const tier = tierOf(70, ctx);
      expect(tier.category).toBe('Good');
      expect(tier.pointsToNext).toBe(15); // to reach 85 (Excellent)
      expect(tier.nextCategory).toBe('Excellent');
    });

    it('categorizes Satisfactory (60-69)', () => {
      const tier = tierOf(65, ctx);
      expect(tier.category).toBe('Satisfactory');
      expect(tier.pointsToNext).toBe(5); // to reach 70 (Good)
      expect(tier.nextCategory).toBe('Good');
    });

    it('categorizes Does Not Meet Standards (< 60)', () => {
      const tier = tierOf(50, ctx);
      expect(tier.category).toBe('Does Not Meet Standards');
    });
  });

  describe('gapToNextTier', () => {
    it('calculates points and raw value needed from Good to Excellent', () => {
      const result = gapToNextTier(70, 'pushups', ctx);
      expect(result.pointGap).toBe(15); // 70 + 15 = 85
      expect(result.rawValueNeeded).toBeGreaterThan(38); // Need more push-ups than 38
    });

    it('returns 0 gap at Outstanding (max tier)', () => {
      const result = gapToNextTier(100, 'pushups', ctx);
      expect(result.pointGap).toBe(0);
    });

    it('estimates raw value correctly for different events', () => {
      // From score 70 in each event, what raw value gets to next tier (85)?
      const pushupGap = gapToNextTier(70, 'pushups', ctx);
      const plankGap = gapToNextTier(70, 'plank', ctx);
      const rowGap = gapToNextTier(70, 'row_2k', ctx);

      // All should need 15 points to reach Excellent (85)
      expect(pushupGap.pointGap).toBe(15);
      expect(plankGap.pointGap).toBe(15);
      expect(rowGap.pointGap).toBe(15);

      // Raw values should be different by event
      expect(pushupGap.rawValueNeeded).toBeGreaterThan(0);
      expect(plankGap.rawValueNeeded).toBeGreaterThan(0);
      expect(rowGap.rawValueNeeded).toBeGreaterThan(0);
    });
  });

  describe('Example from PRD', () => {
    it('matches the provided example exactly', () => {
      // Push-ups: 38 → 70
      expect(eventPoints('pushups', 38, ctx)).toBe(70);
      // Plank: 2:02 (122 sec) → 70
      expect(eventPoints('plank', 122, ctx)).toBe(70);
      // Row: 8:50 (530 sec) → 70
      expect(eventPoints('row_2k', 530, ctx)).toBe(70);
      // Overall Score: 70
      const results = {
        pushups: 38,
        plank: 122,
        row_2k: 530
      };
      expect(composite(results, ctx)).toBe(70);
      expect(tierOf(70, ctx).category).toBe('Good');
    });
  });

  describe('Edge cases', () => {
    it('handles very low values', () => {
      const score = eventPoints('pushups', 0, ctx);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(60);
    });

    it('handles very high values', () => {
      const score = eventPoints('pushups', 200, ctx);
      expect(score).toBe(100);
    });

    it('maintains monotonicity for push-ups (higher reps = higher score)', () => {
      const score1 = eventPoints('pushups', 30, ctx);
      const score2 = eventPoints('pushups', 40, ctx);
      const score3 = eventPoints('pushups', 50, ctx);
      expect(score1).toBeLessThanOrEqual(score2);
      expect(score2).toBeLessThanOrEqual(score3);
    });

    it('maintains monotonicity for plank (longer time = higher score)', () => {
      const score1 = eventPoints('plank', 150, ctx);  // longer
      const score2 = eventPoints('plank', 130, ctx);  // shorter
      const score3 = eventPoints('plank', 110, ctx);  // even shorter
      expect(score1).toBeGreaterThanOrEqual(score2);
      expect(score2).toBeGreaterThanOrEqual(score3);
    });
  });
});
