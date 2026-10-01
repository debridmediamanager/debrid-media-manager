import { describe, expect, it } from 'vitest';
import { BoundedTtlCache } from './boundedTtlCache';

describe('BoundedTtlCache', () => {
	const clock = () => {
		let t = 0;
		return { now: () => t, advance: (ms: number) => (t += ms) };
	};

	it('returns what was stored until its lifetime runs out', () => {
		const time = clock();
		const cache = new BoundedTtlCache<number>(1000, 10, time.now);
		cache.set('a', 1);

		time.advance(999);
		expect(cache.get('a')).toBe(1);
		time.advance(1);
		expect(cache.get('a')).toBeUndefined();
		// An expired entry is dropped when it is read, not kept around.
		expect(cache.size).toBe(0);
	});

	it('never holds more than its limit, evicting the least recently used', () => {
		const cache = new BoundedTtlCache<string>(60_000, 2);
		cache.set('a', 'A');
		cache.set('b', 'B');
		expect(cache.get('a')).toBe('A'); // b is now the older one
		cache.set('c', 'C');

		expect(cache.size).toBe(2);
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBe('A');
		expect(cache.get('c')).toBe('C');
	});

	it('replaces a key in place rather than counting it twice', () => {
		const time = clock();
		const cache = new BoundedTtlCache<number>(1000, 2, time.now);
		cache.set('a', 1);
		time.advance(900);
		cache.set('a', 2);
		time.advance(900);

		expect(cache.size).toBe(1);
		expect(cache.get('a')).toBe(2);
	});

	it('refuses a configuration that would cache nothing or everything', () => {
		expect(() => new BoundedTtlCache(0, 10)).toThrow();
		expect(() => new BoundedTtlCache(1000, 0)).toThrow();
		expect(() => new BoundedTtlCache(1000, Infinity)).toThrow();
	});
});
