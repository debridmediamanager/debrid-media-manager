import { describe, expect, it } from 'vitest';
import { UserTorrentStatus } from './userTorrent';

describe('UserTorrentStatus', () => {
	it('defines all expected status values', () => {
		expect(UserTorrentStatus.waiting).toBe('waiting');
		expect(UserTorrentStatus.downloading).toBe('downloading');
		expect(UserTorrentStatus.finished).toBe('finished');
		expect(UserTorrentStatus.error).toBe('error');
	});

	it('has exactly 4 members', () => {
		const values = Object.values(UserTorrentStatus);
		expect(values).toHaveLength(4);
	});

	it('supports reverse lookup by value', () => {
		expect(UserTorrentStatus['waiting']).toBe('waiting');
		expect(UserTorrentStatus['finished']).toBe('finished');
	});
});
