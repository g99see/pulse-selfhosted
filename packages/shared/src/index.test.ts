import { describe, it, expect } from 'vitest';
import { CheckInInputSchema } from './index';
describe('CheckInInputSchema', () => {
  it('accepts mood 1-5', () => expect(CheckInInputSchema.parse({ mood: 3 }).tags).toEqual([]));
  it('rejects mood 6', () => expect(() => CheckInInputSchema.parse({ mood: 6 })).toThrow());
});
