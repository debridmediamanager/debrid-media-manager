import { dedupeResults, parseNewznabResponse, qualifyReleaseId } from '@/services/nzb2rd';
import { repository } from '@/services/repository';
import althubMovie from '@/test/fixtures/newznab-fresh/althub-movie-2026-10-31.json';
import drunkenslugMovie from '@/test/fixtures/newznab-fresh/drunkenslug-movie-2026-10-31.json';
import recordedMarkers from '@/test/fixtures/transfers/failed-marker-polls-2026-10-07.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copiesOf, groupCopies, orderCopies, recordCopies } from './usenetCopies';

vi.mock('@/services/repository');
const mockRepo = vi.mocked(repository);

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
	vi.clearAllMocks();
	// Both indexers the Usenet tab and /api/nzb2rd/download can fetch from.
	process.env.NEWZNAB_API_KEY = 'ds-key';
	process.env.ALTHUB_API_KEY = 'ah-key';
});
afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

// The newest film posts DrunkenSlug and altHUB answered on 2026-10-31, qualified
// the way fetchResults qualifies them: The Big Lebowski's HDMaNiAcS and TERMiNAL
// releases are on both, and altHUB lists Hell House and True Romance twice each.
const qualified = (prefix: string, body: unknown) =>
	parseNewznabResponse(body).map((r) => ({ ...r, id: qualifyReleaseId(prefix, r.id) }));
const ds = qualified('ds', drunkenslugMovie);
const ah = qualified('ah', althubMovie);

const FIXTURE_COPIES = new Map([
	['ds:8ec039dfffc1781aae35f29ea7f35f54bb6fd1c1', ['ah:61bd8e1892dadf84e4a42d1494ba9cef']],
	['ah:61bd8e1892dadf84e4a42d1494ba9cef', ['ds:8ec039dfffc1781aae35f29ea7f35f54bb6fd1c1']],
	['ds:6b6440fdc833ed29b90954956d7de0d729e17a35', ['ah:b12393c9fe8c7f1b109fa030215a5ca2']],
	['ah:b12393c9fe8c7f1b109fa030215a5ca2', ['ds:6b6440fdc833ed29b90954956d7de0d729e17a35']],
	['ah:3905d618d35bdda502c7ca4c1a35a545', ['ah:de0d2e9ed275e2ae9b3990663e3cb02c']],
	['ah:de0d2e9ed275e2ae9b3990663e3cb02c', ['ah:3905d618d35bdda502c7ca4c1a35a545']],
	['ah:d0b5b5d0478acd6eb6f96a243d001985', ['ah:11a69cda89c294bc2242eb8f9819cd52']],
	['ah:11a69cda89c294bc2242eb8f9819cd52', ['ah:d0b5b5d0478acd6eb6f96a243d001985']],
]);

describe('groupCopies', () => {
	it('names, for every posting of a release posted twice, the other one', () => {
		expect(groupCopies([...ds, ...ah])).toEqual(FIXTURE_COPIES);
	});

	// The Usenet tab folds its rows before caching them; their `alternates` are
	// the rest of each group, so a folded set records the same thing.
	it('records the same from rows the Usenet tab already folded', () => {
		expect(groupCopies(dedupeResults([ds, ah]))).toEqual(FIXTURE_COPIES);
	});

	// A Newznab-only upstream's posting cannot be fetched back through
	// /api/nzb2rd/download, so it is no copy nzb2rd could use.
	it('leaves out postings nzb2rd cannot fetch back', () => {
		const title = 'The.Big.Lebowski.1998.LIMITED.1080p.BluRay.DTS.x264-HDMaNiAcS';
		const copies = groupCopies([
			{ id: 'nl:elsewhere', title },
			{ id: 'ds:a', title },
			{ id: 'en:0123456789abcdef0123', title },
			{ id: 'ah:b', title },
		]);
		expect(copies).toEqual(
			new Map([
				['ds:a', ['ah:b']],
				['ah:b', ['ds:a']],
			])
		);
	});

	it('keeps them in row order, once each, never the posting itself, at most eight', () => {
		const title = 'Show.S01.1080p.WEB-GRP';
		const rows = [
			{ id: 'ds:a', title, alternates: ['ah:b'] },
			...Array.from({ length: 10 }, (_, i) => ({ id: `ds:${i}`, title })),
			{ id: 'ah:b', title },
		];
		expect(groupCopies(rows).get('ds:a')).toEqual([
			'ah:b',
			'ds:0',
			'ds:1',
			'ds:2',
			'ds:3',
			'ds:4',
			'ds:5',
			'ds:6',
		]);
		expect(groupCopies(rows).get('ah:b')?.[0]).toBe('ds:a');
	});
});

describe('recordCopies and copiesOf', () => {
	it('writes the groups and never fails the search that found them', async () => {
		mockRepo.recordUsenetCopies = vi.fn().mockRejectedValue(new Error('db down'));
		await expect(recordCopies([...ds, ...ah])).resolves.toBeUndefined();
		expect(mockRepo.recordUsenetCopies).toHaveBeenCalledWith(FIXTURE_COPIES);
	});

	it('answers none when the read fails', async () => {
		mockRepo.getUsenetCopies = vi.fn().mockRejectedValue(new Error('db down'));
		expect(await copiesOf('ds:a')).toEqual([]);
	});
});

// Failed markers as production wrote them on 2026-10-07: `ix:release-1` failed on
// a dead Real-Debrid token, `ix:release-2` on zurg's two-hour read limit, and
// `ix:release-3` on articles missing from every news server. Only the last says
// the posting itself is dead.
describe('orderCopies', () => {
	const [badToken, timedOut, missing] = recordedMarkers.markers;

	beforeEach(() => {
		mockRepo.getNzb2rdTransfers = vi.fn().mockResolvedValue(recordedMarkers.markers);
		mockRepo.getUsenetDead = vi.fn().mockResolvedValue([]);
	});

	it('puts a posting whose articles are gone last, and fetches the first copy instead', async () => {
		mockRepo.getUsenetCopies = vi
			.fn()
			.mockResolvedValue([badToken.releaseId, timedOut.releaseId]);

		expect(await orderCopies(missing.releaseId)).toEqual({
			id: 'ix:release-1',
			alternates: ['ix:release-2', 'ix:release-3'],
		});
		expect(mockRepo.getNzb2rdTransfers).toHaveBeenCalledWith([
			'ix:release-3',
			'ix:release-1',
			'ix:release-2',
		]);
	});

	it('moves only the dead copies, keeping the others in their order', async () => {
		mockRepo.getUsenetCopies = vi
			.fn()
			.mockResolvedValue(['IX:RELEASE-3', 'ds:never-sent', timedOut.releaseId]);

		expect(await orderCopies(badToken.releaseId)).toEqual({
			id: 'ix:release-1',
			alternates: ['ds:never-sent', 'ix:release-2', 'IX:RELEASE-3'],
		});
	});

	it('keeps the order when every posting is dead', async () => {
		mockRepo.getNzb2rdTransfers = vi
			.fn()
			.mockResolvedValue([missing, { ...missing, releaseId: 'ds:other' }]);
		mockRepo.getUsenetCopies = vi.fn().mockResolvedValue(['ds:other']);

		expect(await orderCopies('ix:release-3')).toEqual({
			id: 'ix:release-3',
			alternates: ['ds:other'],
		});
	});

	it('reads no marker for a posting with no copies', async () => {
		mockRepo.getUsenetCopies = vi.fn().mockResolvedValue([]);

		expect(await orderCopies('ix:release-3')).toEqual({ id: 'ix:release-3', alternates: [] });
		expect(mockRepo.getNzb2rdTransfers).not.toHaveBeenCalled();
	});

	// The Big Lebowski's TERMiNAL release, on both indexers (FIXTURE_COPIES). No job
	// of DMM's failed on the DrunkenSlug posting; nzb2rd or a sponsor's zurg
	// reported it through /api/usenet/dead.
	it('puts a posting reported dead last as well', async () => {
		const [reported, copy] = [...FIXTURE_COPIES].find(([id]) => id.startsWith('ds:6b64'))!;
		mockRepo.getUsenetCopies = vi.fn().mockResolvedValue(copy);
		mockRepo.getUsenetDead = vi.fn().mockResolvedValue([reported]);

		expect(await orderCopies(reported.toUpperCase())).toEqual({
			id: copy[0],
			alternates: [reported.toUpperCase()],
		});
		expect(mockRepo.getUsenetDead).toHaveBeenCalledWith([reported.toUpperCase(), copy[0]]);
	});

	it('still reads the markers when the reports cannot be read, and the other way round', async () => {
		mockRepo.getUsenetCopies = vi.fn().mockResolvedValue(['ds:b']);
		mockRepo.getUsenetDead = vi.fn().mockRejectedValue(new Error('db down'));
		expect(await orderCopies('ix:release-3')).toEqual({
			id: 'ds:b',
			alternates: ['ix:release-3'],
		});

		mockRepo.getNzb2rdTransfers = vi.fn().mockRejectedValue(new Error('db down'));
		mockRepo.getUsenetDead = vi.fn().mockResolvedValue(['ix:release-3']);
		expect(await orderCopies('ix:release-3')).toEqual({
			id: 'ds:b',
			alternates: ['ix:release-3'],
		});
	});

	it('keeps the order when the markers cannot be read', async () => {
		mockRepo.getUsenetCopies = vi.fn().mockResolvedValue(['ds:b']);
		mockRepo.getNzb2rdTransfers = vi.fn().mockRejectedValue(new Error('db down'));

		expect(await orderCopies('ix:release-3')).toEqual({
			id: 'ix:release-3',
			alternates: ['ds:b'],
		});
	});
});
