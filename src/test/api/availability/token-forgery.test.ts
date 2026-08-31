import availabilityHandler from '@/pages/api/availability';
import removeHandler from '@/pages/api/availability/remove';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { mintProblemToken } from '@/utils/problemToken';
import { NextApiHandler } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deliberately does NOT mock '@/utils/problemToken': the point of this file is
// that the real validator stands between a forged token and the `Available`
// table. The per-route tests next door mock it away, so they would have passed
// just as happily against the old client-side scheme — and that scheme's salt
// shipped in the browser bundle, which is the hole this proves closed.
vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const SECRET = 'test-problem-secret-route-level';

// The salt that used to ship in the client bundle, plus the hashing it fed. The
// server-side validator for it is gone, so this is now the only copy — kept
// deliberately: it reproduces exactly what any visitor could mint offline, which
// is the thing these routes must keep refusing. Deleting it would leave nothing
// proving the old forgery still fails.
const LEAKED_SALT = 'debridmediamanager.com%%fe7#td00rA3vHz%VmI';

function legacyHash(str: string): string {
	let hash1 = 0xdeadbeef ^ str.length;
	let hash2 = 0x41c6ce57 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		const charCode = str.charCodeAt(i);
		hash1 = Math.imul(hash1 ^ charCode, 2654435761);
		hash2 = Math.imul(hash2 ^ charCode, 1597334677);
		hash1 = (hash1 << 5) | (hash1 >>> 27);
		hash2 = (hash2 << 5) | (hash2 >>> 27);
	}
	hash1 = (hash1 + Math.imul(hash2, 1566083941)) | 0;
	hash2 = (hash2 + Math.imul(hash1, 2024237689)) | 0;
	return ((hash1 ^ hash2) >>> 0).toString(16);
}

function combineHashes(hash1: string, hash2: string): string {
	const halfLength = Math.floor(hash1.length / 2);
	const secondPart1 = hash1.slice(halfLength);
	const secondPart2 = hash2.slice(halfLength);
	let obfuscated = '';
	for (let i = 0; i < halfLength; i++) {
		obfuscated += hash1[i] + hash2[i];
	}
	return (
		obfuscated +
		secondPart2.split('').reverse().join('') +
		secondPart1.split('').reverse().join('')
	);
}

/** Mint a token the way anyone reading the old browser bundle could. */
function forgeFromLeakedSalt(): [string, string] {
	const nonce = 'deadbeef';
	const token = `${nonce}-${Math.floor(Date.now() / 1000)}`;
	return [token, combineHashes(legacyHash(token), legacyHash(`${LEAKED_SALT}-${nonce}`))];
}

const validHash = 'd'.repeat(40);

const routes = [
	{
		name: 'POST /api/availability (write)',
		handler: availabilityHandler as NextApiHandler,
		dbCall: () => mockRepository.upsertAvailability,
		body: (dmmProblemKey: unknown, solution: unknown) => ({
			dmmProblemKey,
			solution,
			filename: 'file.mkv',
			original_filename: 'original.mkv',
			hash: validHash,
			bytes: 1000,
			original_bytes: 2000,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			files: [{ id: 1, path: 'movie/file.mkv', bytes: 1000, selected: 1 }],
			links: ['https://real-debrid.com/download/123'],
			ended: '2024-01-01T00:00:00Z',
			imdbId: 'tt1234567',
		}),
	},
	{
		name: 'POST /api/availability/remove (delete)',
		handler: removeHandler as NextApiHandler,
		dbCall: () => mockRepository.removeAvailability,
		body: (dmmProblemKey: unknown, solution: unknown) => ({
			dmmProblemKey,
			solution,
			hash: validHash,
			reason: 'user-request',
		}),
	},
];

describe.each(routes)('$name refuses forged availability tokens', ({ handler, dbCall, body }) => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		// Legacy off is the end state; one case below turns it back on to pin
		// down what the transitional release still lets through.
		process.env = { ...originalEnv, DMM_PROBLEM_SECRET: SECRET };
		mockRepository.upsertAvailability = vi.fn().mockResolvedValue(undefined);
		mockRepository.removeAvailability = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	const post = async (dmmProblemKey: unknown, solution: unknown) => {
		const req = createMockRequest({ method: 'POST', body: body(dmmProblemKey, solution) });
		const res = createMockResponse();
		await handler(req, res);
		return res;
	};

	it('refuses garbage credentials without reaching the database', async () => {
		const res = await post('not-a-token', 'not-a-signature');

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(dbCall()).not.toHaveBeenCalled();
	});

	// The vulnerability itself: this exact pair used to be accepted, so the
	// table's writes and deletes were open to anyone who read the bundle.
	it('refuses a token forged offline from the leaked bundle salt', async () => {
		const [token, hash] = forgeFromLeakedSalt();

		const res = await post(token, hash);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(dbCall()).not.toHaveBeenCalled();
	});

	it('refuses a token signed with a key the server does not hold', async () => {
		const [token, hash] = mintProblemToken('some-other-secret');

		const res = await post(token, hash);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(dbCall()).not.toHaveBeenCalled();
	});

	it('refuses a genuine token whose signature was tampered with', async () => {
		const [token, hash] = mintProblemToken(SECRET);

		const res = await post(token, `${hash.slice(0, -1)}${hash.endsWith('A') ? 'B' : 'A'}`);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(dbCall()).not.toHaveBeenCalled();
	});

	it('refuses a token older than its window', async () => {
		const [token, hash] = mintProblemToken(SECRET, Date.now() - 6 * 60 * 1000);

		const res = await post(token, hash);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(dbCall()).not.toHaveBeenCalled();
	});

	// This used to document the changeover's cost: with the legacy branch on, a
	// bundle-derived forgery reached the database. That branch is gone, so the
	// same request must now be refused with nothing written.
	it('refuses a legacy forgery outright now the grace period has ended', async () => {
		const [token, hash] = forgeFromLeakedSalt();

		const res = await post(token, hash);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(dbCall()).not.toHaveBeenCalled();
	});

	it('accepts a freshly minted token and proceeds to the database', async () => {
		const [token, hash] = mintProblemToken(SECRET);

		const res = await post(token, hash);

		expect(dbCall()).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ success: true });
	});
});
