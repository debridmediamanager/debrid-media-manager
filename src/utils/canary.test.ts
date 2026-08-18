import { beforeEach, describe, expect, it } from 'vitest';
import {
	CANARY_CEILING,
	CANARY_FLOOR,
	classifyCanary,
	TRAP_POOL,
	TRAPS_PER_ROTATION,
	trapsForRotation,
} from './canary';

describe('classifyCanary', () => {
	beforeEach(() => {
		delete process.env.CANARY_VOID_FLOOR;
	});

	it('leaves ids a real user can reach alone', () => {
		// tt40000000 is a real IMDb episode - the reason the canary space is not
		// parked just above the allocation frontier.
		for (const id of ['tt0111161', 'tt1234567', 'tt21965154', 'tt40000000', 'tt99999999']) {
			expect(classifyCanary(id)).toBeNull();
		}
	});

	it('flags every published trap', () => {
		for (const id of TRAP_POOL) {
			expect(classifyCanary(id)).toBe('trap');
		}
	});

	it('flags unpublished ids inside the canary space', () => {
		expect(classifyCanary('tt900000001')).toBe('void');
		expect(classifyCanary(`tt${CANARY_FLOOR}`)).toBe('void');
		expect(classifyCanary(`tt${CANARY_CEILING}`)).toBe('void');
	});

	it('flags ids too long to be a real title', () => {
		expect(classifyCanary('tt99999999999999999999999')).toBe('void');
	});

	it('ignores anything that is not an imdb id', () => {
		for (const id of ['', 'nm0000123', 'tt', 'ttabc', '900000001', undefined, null]) {
			expect(classifyCanary(id as string)).toBeNull();
		}
	});

	it('trims surrounding whitespace before classifying', () => {
		expect(classifyCanary(`  ${TRAP_POOL[0]}  `)).toBe('trap');
	});

	it('honours a configured floor', () => {
		process.env.CANARY_VOID_FLOOR = '50000000';
		expect(classifyCanary('tt50000001')).toBe('void');
		expect(classifyCanary('tt49999999')).toBeNull();
	});

	it('falls back to the default floor when the override is nonsense', () => {
		process.env.CANARY_VOID_FLOOR = 'banana';
		expect(classifyCanary('tt50000001')).toBeNull();
		expect(classifyCanary('tt900000001')).toBe('void');
	});
});

describe('TRAP_POOL', () => {
	it('is unique and inside the canary space', () => {
		expect(new Set(TRAP_POOL).size).toBe(TRAP_POOL.length);
		for (const id of TRAP_POOL) {
			const numeric = Number(id.slice(2));
			expect(numeric).toBeGreaterThanOrEqual(CANARY_FLOOR);
			expect(numeric).toBeLessThanOrEqual(CANARY_CEILING);
		}
	});
});

describe('trapsForRotation', () => {
	const day = 86_400_000;

	it('is stable within a day and rotates across days', () => {
		const today = trapsForRotation(day * 100);
		expect(trapsForRotation(day * 100 + 1000)).toEqual(today);
		expect(trapsForRotation(day * 101)).not.toEqual(today);
	});

	it('publishes a rotation of traps that all classify as traps', () => {
		const traps = trapsForRotation(day * 100);
		expect(traps).toHaveLength(TRAPS_PER_ROTATION);
		for (const id of traps) {
			expect(classifyCanary(id)).toBe('trap');
		}
	});

	it('covers the whole pool as days pass', () => {
		const seen = new Set<string>();
		for (let d = 0; d < TRAP_POOL.length; d++) {
			trapsForRotation(day * d).forEach((id) => seen.add(id));
		}
		expect(seen.size).toBe(TRAP_POOL.length);
	});
});
