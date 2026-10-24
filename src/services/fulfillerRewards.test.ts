import { repository } from '@/services/repository';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { creditFulfiller, fulfillerStats, leaderboard } from './fulfillerRewards';

vi.mock('@/services/repository');
const db = vi.mocked(repository);

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-24T12:00:00Z');

/** `n` sends to different askers, which all count. */
const sends = (n: number, thanked = 0) =>
	Array.from({ length: n }, (_, i) => ({
		requesterId: `asker-${i}`,
		fulfilledAt: new Date('2026-10-20T10:00:00Z'),
		thankedAt: i < thanked ? new Date() : null,
	}));

beforeEach(() => {
	vi.clearAllMocks();
	db.getFulfillerLinks = vi
		.fn()
		.mockResolvedValue([{ fulfillerId: 'tb:abc', shortId: 'ZP1M', showName: false }]);
	db.getFulfillerLinksForSponsors = vi.fn().mockResolvedValue([
		{ fulfillerId: 'tb:abc', shortId: 'ZP1M', showName: false },
		{ fulfillerId: 'rd-id', shortId: 'ZP1M', showName: false },
	]);
	db.listContentRequestSendsBy = vi.fn().mockResolvedValue(sends(10));
	db.getSponsorEarned = vi.fn().mockResolvedValue(null);
	db.paySponsorEarned = vi.fn().mockResolvedValue(true);
	db.getSponsorGithubNames = vi.fn().mockResolvedValue(new Map([['ZP1M', 'octocat']]));
});

describe('creditFulfiller', () => {
	it('pays 7 days for the 10th send', async () => {
		await creditFulfiller('tb:abc', NOW);
		expect(db.paySponsorEarned).toHaveBeenCalledWith(
			'ZP1M',
			null,
			1,
			new Date(NOW.getTime() + 7 * DAY)
		);
	});

	// One person fulfils under a Real-Debrid id or a TorBox id depending on
	// whether they were signed in; both count for the same sponsorship.
	it('counts sends made under every id linked to the sponsorship', async () => {
		await creditFulfiller('tb:abc', NOW);
		expect(db.listContentRequestSendsBy).toHaveBeenCalledWith(['tb:abc', 'rd-id']);
	});

	it('pays nothing twice', async () => {
		db.getSponsorEarned = vi
			.fn()
			.mockResolvedValue({ earnedUntil: new Date(NOW.getTime() + DAY), creditedBlocks: 1 });
		await creditFulfiller('tb:abc', NOW);
		expect(db.paySponsorEarned).not.toHaveBeenCalled();
	});

	it('stacks a new block on time still left', async () => {
		const left = new Date(NOW.getTime() + 3 * DAY);
		db.listContentRequestSendsBy = vi.fn().mockResolvedValue(sends(20));
		db.getSponsorEarned = vi.fn().mockResolvedValue({ earnedUntil: left, creditedBlocks: 1 });
		await creditFulfiller('tb:abc', NOW);
		expect(db.paySponsorEarned).toHaveBeenCalledWith(
			'ZP1M',
			1,
			2,
			new Date(left.getTime() + 7 * DAY)
		);
	});

	it('pays nobody until a sponsorship is linked', async () => {
		db.getFulfillerLinks = vi.fn().mockResolvedValue([]);
		await creditFulfiller('tb:abc', NOW);
		expect(db.paySponsorEarned).not.toHaveBeenCalled();
	});

	it('pays nothing short of ten counted sends', async () => {
		db.listContentRequestSendsBy = vi.fn().mockResolvedValue(sends(9));
		await creditFulfiller('tb:abc', NOW);
		expect(db.paySponsorEarned).not.toHaveBeenCalled();
	});
});

describe('fulfillerStats', () => {
	it('reports sends, thanks and progress', async () => {
		db.listContentRequestSendsBy = vi.fn().mockResolvedValue(sends(13, 4));
		const stats = await fulfillerStats(['tb:abc']);
		expect(stats).toMatchObject({ sends: 13, thanked: 4, credited: 13, linked: true });
		expect(stats.earnedUntil).toBeNull();
	});

	it('reads the sends of an unlinked fulfiller by the ids given', async () => {
		db.getFulfillerLinks = vi.fn().mockResolvedValue([]);
		db.listContentRequestSendsBy = vi.fn().mockResolvedValue(sends(2));
		const stats = await fulfillerStats(['tb:new']);
		expect(db.listContentRequestSendsBy).toHaveBeenCalledWith(['tb:new']);
		expect(stats).toMatchObject({ sends: 2, linked: false });
	});
});

describe('leaderboard', () => {
	beforeEach(() => {
		db.countContentRequestSendsByFulfiller = vi.fn().mockResolvedValue([
			{ fulfillerId: 'tb:solo', sends: 9 },
			{ fulfillerId: 'tb:abc', sends: 5 },
			{ fulfillerId: 'rd-id', sends: 6 },
		]);
		db.getFulfillerLinks = vi.fn().mockResolvedValue([
			{ fulfillerId: 'tb:abc', shortId: 'ZP1M', showName: true },
			{ fulfillerId: 'rd-id', shortId: 'ZP1M', showName: true },
		]);
	});

	it('adds up one person’s ids and names only who opted in', async () => {
		expect(await leaderboard(null)).toEqual([
			{ name: 'octocat', sends: 11 },
			{ name: null, sends: 9 },
		]);
	});

	it('never names a fulfiller who did not opt in', async () => {
		db.getFulfillerLinks = vi
			.fn()
			.mockResolvedValue([{ fulfillerId: 'tb:abc', shortId: 'ZP1M', showName: false }]);
		const board = await leaderboard(null);
		expect(board.every((e) => e.name === null)).toBe(true);
		expect(JSON.stringify(board)).not.toMatch(/tb:|rd-id|ZP1M/);
	});
});
