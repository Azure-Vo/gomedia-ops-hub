import { describe, expect, it } from 'vitest';
import { normalizeVi, searchScore } from './search';

describe('normalizeVi', () => {
  it('strips Vietnamese accents, đ and case', () => {
    expect(normalizeVi('Quay dựng  Video ĐẸP')).toBe('quay dung video dep');
  });
});

describe('searchScore', () => {
  it('matches without accents', () => {
    expect(searchScore('quay dung', 'Quay dựng video sản phẩm')).toBeGreaterThan(0);
    expect(searchScore('san pham', 'Chụp ảnh sản phẩm (nửa ngày)')).toBeGreaterThan(0);
  });

  it('needs every word to match somewhere', () => {
    expect(searchScore('video koc', 'Video TikTok ngắn', ['DEMO-SOC-01', 'Social Media'])).toBe(0);
    expect(searchScore('video koc', 'Video review sản phẩm của KOC', ['DEMO-INF-04', 'Influencer'])).toBeGreaterThan(0);
  });

  it('matches code, group and unit', () => {
    expect(searchScore('inf-04', 'Video review', ['DEMO-INF-04', 'Influencer', 'video'])).toBeGreaterThan(0);
    expect(searchScore('influencer', 'Booking micro-KOC', ['DEMO-INF-01', 'Influencer', 'booking'])).toBeGreaterThan(0);
  });

  it('ranks name-start above mid-word and above other fields', () => {
    const start = searchScore('livestream', 'Livestream bán hàng (2 giờ)');
    const word = searchScore('livestream', 'Booking KOC livestream');
    const other = searchScore('livestream', 'Quay flycam', ['livestream']);
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(other);
  });

  it('empty query matches everything', () => {
    expect(searchScore('  ', 'Anything')).toBe(1);
  });
});
