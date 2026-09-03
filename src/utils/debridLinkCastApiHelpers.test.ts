import {
	addSeedboxTorrent,
	DebridLinkError,
	getDebridLinkAccountInfo,
	getSeedboxTorrent,
} from '@/services/debridLink';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	describeDebridLinkError,
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
	resolveDebridLinkTorrentById,
	resolveDebridLinkUser,
} from './debridLinkCastApiHelpers';

vi.mock('@/services/debridLink', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/debridLink')>('@/services/debridLink');
	return {
		...actual,
		getDebridLinkAccountInfo: vi.fn(),
		addSeedboxTorrent: vi.fn(),
		getSeedboxTorrent: vi.fn(),
	};
});

const mockInfo = vi.mocked(getDebridLinkAccountInfo);
const mockAdd = vi.mocked(addSeedboxTorrent);
const mockById = vi.mocked(getSeedboxTorrent);
const originalSalt = process.env.DMMCAST_SALT;

const torrent = (over: Record<string, unknown> = {}) =>
	({
		id: 'tor-1',
		name: 'Release',
		status: 100,
		downloadPercent: 100,
		files: [
			{
				id: 'f0',
				name: 'Release/Movie.mkv',
				size: 500,
				downloadUrl: 'https://seed41.debrid.link/dl/tor-1-0/Movie.mkv',
				downloadPercent: 100,
			},
		],
		...over,
	}) as any;

describe('debridLinkCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = 'test-dl-salt';
		mockInfo.mockReset();
		mockAdd.mockReset();
		mockById.mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	describe('resolveDebridLinkUser', () => {
		it('answers validity and the user id in one round trip', async () => {
			mockInfo.mockResolvedValue({ username: 'ymsita', accountType: 1 } as any);

			const result = await resolveDebridLinkUser('token');

			expect(result.valid).toBe(true);
			expect(result.userId).toHaveLength(12);
			expect(result.premium).toBe(true);
			expect(mockInfo).toHaveBeenCalledTimes(1);
		});

		it('is stable for the same account and different across accounts', async () => {
			mockInfo.mockResolvedValue({ username: 'ymsita' } as any);
			const first = await generateDebridLinkUserId('token');
			const again = await generateDebridLinkUserId('token');
			mockInfo.mockResolvedValue({ username: 'someone-else' } as any);
			const other = await generateDebridLinkUserId('token');

			expect(first).toBe(again);
			expect(other).not.toBe(first);
		});

		// Namespaced so a Debrid-Link user id can never collide with the id
		// another provider derives from the same string.
		it('is namespaced away from the other providers', async () => {
			mockInfo.mockResolvedValue({ username: 'shared-identifier' } as any);
			const dl = await generateDebridLinkUserId('token');

			const crypto = await import('crypto');
			const unprefixed = crypto
				.createHmac('sha256', 'test-dl-salt')
				.update('shared-identifier')
				.digest('base64url')
				.slice(0, 12);
			const offcloud = crypto
				.createHmac('sha256', 'test-dl-salt')
				.update('offcloud:shared-identifier')
				.digest('base64url')
				.slice(0, 12);

			expect(dl).not.toBe(unprefixed);
			expect(dl).not.toBe(offcloud);
		});

		// The email `/account/infos` returns is partially masked and user-editable;
		// the username is the identifier that cannot drift.
		it('keys on the username, not the masked email', async () => {
			mockInfo.mockResolvedValue({ username: 'ymsita', email: 'p**d@deb*******k' } as any);
			const first = await generateDebridLinkUserId('token');
			mockInfo.mockResolvedValue({ username: 'ymsita', email: 'changed@example.com' } as any);
			expect(await generateDebridLinkUserId('token')).toBe(first);
		});

		it('reports an unusable token without a username', async () => {
			mockInfo.mockResolvedValue({} as any);
			expect(await resolveDebridLinkUser('token')).toEqual({ valid: false });
		});

		it('reports a thrown lookup as an invalid token', async () => {
			mockInfo.mockRejectedValue(new DebridLinkError('bad', 'badToken'));
			expect(await resolveDebridLinkUser('token')).toEqual({ valid: false });
			await expect(generateDebridLinkUserId('token')).rejects.toThrow(
				'Failed to generate Debrid-Link user ID'
			);
		});

		it('surfaces a missing salt rather than calling the token invalid', async () => {
			delete process.env.DMMCAST_SALT;
			mockInfo.mockResolvedValue({ username: 'ymsita' } as any);
			await expect(resolveDebridLinkUser('token')).rejects.toThrow('DMMCAST_SALT');
		});
	});

	describe('resolveDebridLinkRelease', () => {
		// A bare hash is only accepted when the content is already cached, so the
		// full magnet is what makes "cast this" mean "make it playable".
		it('adds the full magnet, never a bare hash', async () => {
			mockAdd.mockResolvedValue(torrent());
			await resolveDebridLinkRelease('token', 'a'.repeat(40));
			expect(mockAdd).toHaveBeenCalledWith('token', `magnet:?xt=urn:btih:${'a'.repeat(40)}`);
		});

		it('reports a cached release as finished with its files', async () => {
			mockAdd.mockResolvedValue(torrent());
			const resolved = await resolveDebridLinkRelease('token', 'a'.repeat(40));

			expect(resolved.finished).toBe(true);
			expect(resolved.files[0].link).toBe('https://seed41.debrid.link/dl/tor-1-0/Movie.mkv');
		});

		// The vendor's own sample carries `status: 6`, which is
		// VERIFICATION|DOWNLOADING and equals no single enum member - so the
		// completion test has to be a threshold, never an equality.
		it('treats a combined flag status as unfinished, not as an unknown state', async () => {
			mockAdd.mockResolvedValue(torrent({ status: 6, downloadPercent: 42 }));
			const resolved = await resolveDebridLinkRelease('token', 'a'.repeat(40));

			expect(resolved.finished).toBe(false);
			expect(resolved.percent).toBe(42);
		});

		// Nothing is removed afterwards: the add is idempotent, so an add on a
		// torrent the caller already had is indistinguishable from one that
		// created it, and Debrid-Link's remove never fails.
		it('adds and nothing else', async () => {
			mockAdd.mockResolvedValue(torrent());
			await resolveDebridLinkRelease('token', 'a'.repeat(40));
			expect(mockAdd).toHaveBeenCalledTimes(1);
		});
	});

	describe('resolveDebridLinkTorrentById', () => {
		it('resolves a held torrent without spending an add', async () => {
			mockById.mockResolvedValue(torrent());
			const resolved = await resolveDebridLinkTorrentById('token', 'tor-1');

			expect(resolved?.finished).toBe(true);
			expect(mockAdd).not.toHaveBeenCalled();
		});

		it('reports an unknown id as nothing rather than throwing', async () => {
			mockById.mockResolvedValue(null);
			expect(await resolveDebridLinkTorrentById('token', 'nope')).toBeNull();
		});
	});

	describe('describeDebridLinkError', () => {
		it.each([
			['maxTorrent', '50 per day'],
			['maxTransfer', '20 active transfers'],
			['floodDetected', 'an hour'],
			['torrentTooBig', '1 TiB'],
			['notAddTorrent', 'Not cached'],
			['badToken', 'sign in again'],
		])('says something actionable for %s', (code, fragment) => {
			expect(describeDebridLinkError(new DebridLinkError('raw', code))).toContain(fragment);
		});

		it('falls back to the API message for an unmapped code', () => {
			expect(
				describeDebridLinkError(new DebridLinkError('something odd', 'unknownCode'))
			).toBe('something odd');
		});

		it('handles a plain error', () => {
			expect(describeDebridLinkError(new Error('boom'))).toBe('boom');
			expect(describeDebridLinkError('not an error')).toBe('Unknown error');
		});
	});
});
