/**
 * Location   : tests/constants.test.js
 * Purpose    : Validate constant values
 * Why        : Ensure configuration values are within expected ranges
 * Related    : src/constants.js
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_INPUT_LENGTH,
  DEFAULT_PORT,
  MIN_PORT,
  MAX_PORT,
  MAX_CONNECTIONS,
} from '../src/constants.js';

describe('constants', () => {
  describe('MAX_INPUT_LENGTH', () => {
    it('should be 10000', () => {
      expect(MAX_INPUT_LENGTH).toBe(10000);
    });

    it('should be a positive integer', () => {
      expect(MAX_INPUT_LENGTH).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_INPUT_LENGTH)).toBe(true);
    });
  });

  describe('Port constants', () => {
    it('should have DEFAULT_PORT between MIN_PORT and MAX_PORT', () => {
      expect(DEFAULT_PORT).toBeGreaterThanOrEqual(MIN_PORT);
      expect(DEFAULT_PORT).toBeLessThanOrEqual(MAX_PORT);
    });

    it('should have MIN_PORT as 1024', () => {
      expect(MIN_PORT).toBe(1024);
    });

    it('should have MAX_PORT as 65535', () => {
      expect(MAX_PORT).toBe(65535);
    });
  });

  describe('MAX_CONNECTIONS', () => {
    it('should be 3', () => {
      expect(MAX_CONNECTIONS).toBe(3);
    });

    it('should be a positive integer', () => {
      expect(MAX_CONNECTIONS).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_CONNECTIONS)).toBe(true);
    });
  });
});
