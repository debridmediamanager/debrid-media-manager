import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyFilenames } from './jev';
import { MEDIA_CHOICES, TITLE_CHOICES } from './rules';

const movie = { titles: ['Barbarian', 'Варвар'], year: 2022 };

function answering(pick: (id: string) => string, status = 200) {
	return vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		const answers = Object.fromEntries(
			Object.keys(body.questions).map((id) => [id, { type: 'choice', choice: pick(id) }])
		);
		return new Response(
			JSON.stringify({
				model: 'jev-1.13.0',
				answers,
				usage: { input_tokens: 100, output_tokens: 9 },
			}),
			{ status }
		);
	});
}

describe('classifyFilenames', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('asks the two narrow questions per filename with the movie as shared state', async () => {
		const fetchMock = answering((id) => (id.startsWith('m') ? 'FILM' : 'SAME_TITLE'));
		vi.stubGlobal('fetch', fetchMock);

		const result = await classifyFilenames('key', movie, ['Barbarian.2022.1080p']);

		expect(result).toEqual({
			answers: [{ media: 'FILM', titleMatch: 'SAME_TITLE' }],
			model: 'jev-1.13.0',
			inputTokens: 100,
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.typesafe.ai/v1/systemone');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
		const body = JSON.parse(init.body as string);
		expect(body.state).toEqual({ movie });
		expect(body.questions.m0.criteria).toEqual(MEDIA_CHOICES);
		expect(body.questions.t0.criteria).toEqual(TITLE_CHOICES);
		expect(body.questions.t0.instructions.filename).toBe('Barbarian.2022.1080p');
	});

	it('sends 75 filenames per request and adds up the tokens', async () => {
		const fetchMock = answering((id) => (id.startsWith('m') ? 'TV' : 'NO_TITLE'));
		vi.stubGlobal('fetch', fetchMock);
		const names = Array.from({ length: 160 }, (_, i) => `file ${i}`);

		const result = await classifyFilenames('key', movie, names);

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const sizes = fetchMock.mock.calls.map(
			([, init]) => Object.keys(JSON.parse(init.body as string).questions).length
		);
		expect(sizes).toEqual([150, 150, 20]);
		expect(result.answers).toHaveLength(160);
		expect(result.inputTokens).toBe(300);
	});

	it('refuses an answer outside the offered choices rather than guessing', async () => {
		vi.stubGlobal(
			'fetch',
			answering(() => 'MAYBE')
		);
		await expect(classifyFilenames('key', movie, ['x'])).rejects.toThrow('outside the offered');
	});

	it('fails on an HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			answering(() => 'FILM', 503)
		);
		await expect(classifyFilenames('key', movie, ['x'])).rejects.toThrow('HTTP 503');
	});
});
