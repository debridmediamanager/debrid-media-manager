import { describe, expect, it } from 'vitest';
import { timeAgo } from './timeAgo';

describe('timeAgo', () => {
	const now = Date.parse('2026-10-25T12:00:00Z');
	it.each([
		['2026-10-25T11:59:30Z', 'just now'],
		['2026-10-25T11:58:00Z', '2m ago'],
		['2026-10-25T07:00:00Z', '5h ago'],
		['2026-09-18T12:00:00Z', '37d ago'],
		// A server clock a little ahead of the viewer's must not read as negative.
		['2026-10-25T12:05:00Z', 'just now'],
	])('%s reads %s', (iso, label) => expect(timeAgo(iso, now)).toBe(label));
});
