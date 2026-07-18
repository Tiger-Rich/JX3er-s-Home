import { describe, expect, it } from 'vitest';

import { normalizeFeedTimestamp } from '../server/feedDiscovery.js';

describe('feed discovery timestamps', () => {
  it('marks SQLite CURRENT_TIMESTAMP values as UTC before freshness scoring', () => {
    expect(normalizeFeedTimestamp('2026-07-14 00:00:00')).toBe(
      '2026-07-14T00:00:00.000Z',
    );
  });
});
