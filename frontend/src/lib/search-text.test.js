import { describe, expect, it } from 'vitest';
import { highlightSegments, matchesSearch, normalizeSearchText } from './search-text';

describe('normalizeSearchText', () => {
  it('applies NFKC, locale-safe lowercase and trim', () => {
    expect(normalizeSearchText('  ＡＢＣ ')).toBe('abc');
    expect(normalizeSearchText('任意社会学')).toBe('任意社会学');
    expect(normalizeSearchText('ﬁle')).toBe('file');
    expect(normalizeSearchText(null)).toBe('');
  });
});

describe('matchesSearch', () => {
  it('matches Chinese substrings and fullwidth-insensitive queries', () => {
    expect(matchesSearch('任意社会学·晚间场', '社会学')).toBe(true);
    expect(matchesSearch('任意社会学', 'ＡＢＣ')).toBe(false);
    expect(matchesSearch('文艺工程学', '文艺')).toBe(true);
    expect(matchesSearch('任意社会学', '')).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('highlights on the original string, not the normalized one', () => {
    const segments = highlightSegments('任意社会学·晚间场', '社会学');
    expect(segments).toEqual([
      { text: '任意', hit: false, first: false },
      { text: '社会学', hit: true, first: true },
      { text: '·晚间场', hit: false, first: false }
    ]);
  });

  it('maps fullwidth matches back onto original characters', () => {
    const segments = highlightSegments('频道ＡＢＣ直播', 'abc');
    expect(segments[1]).toEqual({ text: 'ＡＢＣ', hit: true, first: true });
    expect(segments.map(segment => segment.text).join('')).toBe('频道ＡＢＣ直播');
  });

  it('degrades to no highlight when mapping is impossible', () => {
    expect(highlightSegments('任意社会学', '不存在')).toEqual([{ text: '任意社会学', hit: false, first: false }]);
    expect(highlightSegments('任意社会学', '')).toEqual([{ text: '任意社会学', hit: false, first: false }]);
  });
});
