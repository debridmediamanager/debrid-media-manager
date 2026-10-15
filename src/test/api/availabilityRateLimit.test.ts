/**
 * The availability routes' per-address budget, replayed from dmm-01's access log.
 *
 * They had none: anyone holding a token from /api/challenge could ask about 100
 * hashes a call as fast as they liked. The budget is sized to let the site's own
 * pages through: the 99th percentile address is served in full, and the busiest
 * minute any single-browser address sent is held to 180, the rest waiting out
 * Retry-After in the page.
 */
import check from '@/pages/api/availability/check';
import check2 from '@/pages/api/availability/check2';
import { repository } from '@/services/repository';
import fixture from '@/test/fixtures/availabilityRateLimit/npm-access-log.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { parseNpmAccessLine } from '@/test/utils/npmAccessLog';
import { postAvailability } from '@/utils/availability';
import { validateProblemToken } from '@/utils/problemToken';
import type { NextApiHandler } from 'next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/rateLimit/withRateLimit');
vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const routes: Record<string, NextApiHandler> = {
	'/api/availability/check': check,
	'/api/availability/check2': check2,
};
const HASH = 'a'.repeat(40);

async function replay(lines: string[]) {
	const outcomes = { served: 0, refused: 0 };
	for (const line of lines) {
		const logged = parseNpmAccessLine(line);
		vi.setSystemTime(logged.at);
		const res = createMockResponse();
		await routes[logged.path](
			createMockRequest({
				method: 'POST',
				url: logged.path,
				body: { dmmProblemKey: 'k', solution: 's', imdbId: 'tt0133093', hashes: [HASH] },
				headers: { 'cf-connecting-ip': logged.clientIp, 'sec-fetch-site': 'same-origin' },
			}),
			res
		);
		const status = res._getStatusCode();
		if (status === 429) outcomes.refused++;
		else if (status === 200) outcomes.served++;
		else throw new Error(`status ${status}`);
	}
	return outcomes;
}

describe('availability budget, replayed from the access log', () => {
	const originalRedis = process.env.REDIS_URL;

	beforeAll(() => {
		delete process.env.REDIS_URL;
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		if (originalRedis !== undefined) process.env.REDIS_URL = originalRedis;
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.mocked(validateProblemToken).mockReturnValue(true);
		Object.assign(repository, {
			checkAvailability: vi.fn().mockResolvedValue([]),
			checkAvailabilityByHashes: vi.fn().mockResolvedValue([]),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const sequence = (name: string) => fixture.sequences.find((s) => s.name === name)!.lines;

	it('serves the 99th percentile address in full', async () => {
		expect(await replay(sequence('typical'))).toEqual({ served: 77, refused: 0 });
	});

	it('holds the busiest single-browser minute to 180', async () => {
		expect(await replay(sequence('busiest'))).toEqual({ served: 180, refused: 73 });
	});
});

describe('postAvailability', () => {
	it('waits out a refusal and asks again', async () => {
		const answers = [
			new Response(null, { status: 429, headers: { 'retry-after': '7' } }),
			new Response('{"available":[]}', { status: 200 }),
		];
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async () => answers.shift()!);
		const wait = vi.fn().mockResolvedValue(undefined);

		const response = await postAvailability(
			'/api/availability/check',
			{ method: 'POST' },
			wait
		);

		expect(response.status).toBe(200);
		expect(wait).toHaveBeenCalledWith(7000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		fetchMock.mockRestore();
	});
});
