import { timingSafeEqual } from 'crypto';

/** Constant-time check of a presented secret; anything but a string is a mismatch. */
export function secretEquals(given: unknown, expected: string): boolean {
	if (typeof given !== 'string') return false;
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
