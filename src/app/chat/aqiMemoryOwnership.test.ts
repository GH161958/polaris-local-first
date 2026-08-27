import { describe, expect, it } from 'vitest';

import { shouldUsePolarisSemanticRecall } from './aqiLedgerMirror';

describe('Aqi Home Memory ownership', () => {
  it('disables Polaris semantic recall for the Aqi Home Core route', () => {
    expect(
      shouldUsePolarisSemanticRecall(
        { baseUrl: '/api', path: '/chat/completions' },
        true
      )
    ).toBe(false);
  });

  it('preserves the user recall preference for direct external providers', () => {
    const api = {
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions'
    };

    expect(shouldUsePolarisSemanticRecall(api, true)).toBe(true);
    expect(shouldUsePolarisSemanticRecall(api, false)).toBe(false);
  });
});
