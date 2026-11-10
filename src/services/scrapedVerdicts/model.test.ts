import { afterEach, describe, expect, it, vi } from 'vitest';
import labelled from './__fixtures__/labelled-filenames.json';
import recorded from './__fixtures__/openrouter-gemma-2026-11-10.json';
import { classifyFilenames, MODEL, modelKey } from './model';
import { decide, type Media, type TitleMatch } from './rules';

const movie = recorded.movie;
const exchange = recorded.exchanges[0];

/** Answers every request with `reply(filenames)` as the model's message content. */
function replying(reply: (count: number) => string, status = 200) {
	return vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		const count = (body.messages[1].content.match(/^\d+\. /gm) ?? []).length;
		return new Response(
			JSON.stringify({
				model: MODEL,
				choices: [{ message: { content: reply(count) } }],
				usage: { prompt_tokens: 100, completion_tokens: 20 },
			}),
			{ status }
		);
	});
}

const all = (media: string, title: string) => (count: number) =>
	JSON.stringify(
		Object.fromEntries(
			Array.from({ length: count }, (_, i) => [String(i + 1), { media, title }])
		)
	);

describe('classifyFilenames', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it('sends the recorded request and reads the recorded Gemma reply', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(exchange.response)));
		vi.stubGlobal('fetch', fetchMock);

		const result = await classifyFilenames('key', movie, recorded.filenames);

		expect(result).toEqual(recorded.result);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
		// the prompt the recorded answers were given; a change here needs a new recording
		expect(JSON.parse(init.body as string)).toEqual(exchange.request);
		expect(result.tokens).toBe(
			exchange.response.usage.prompt_tokens + exchange.response.usage.completion_tokens
		);
	});

	it("keeps the recorded page's four real releases and trashes the other four", () => {
		const shawshank = { imdbId: 'tt0111161', ...labelled.movies.tt0111161 };
		const verdicts = recorded.filenames.map((filename, i) => {
			const { media, titleMatch } = recorded.result.answers[i];
			return decide(shawshank, filename, media as Media, titleMatch as TitleMatch);
		});
		expect(verdicts).toEqual([
			'keep',
			'keep',
			'keep',
			'keep',
			'trash',
			'trash',
			'trash',
			'trash',
		]);
	});

	it('sends 40 filenames per request and adds up input and output tokens', async () => {
		const fetchMock = replying(all('TV', 'NO_TITLE'));
		vi.stubGlobal('fetch', fetchMock);
		const names = Array.from({ length: 85 }, (_, i) => `file ${i}`);

		const result = await classifyFilenames('key', movie, names);

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(result.answers).toHaveLength(85);
		expect(result.answers[84]).toEqual({ media: 'TV', titleMatch: 'NO_TITLE' });
		expect(result.tokens).toBe(360);
	});

	it('reads a reply wrapped in a code fence', async () => {
		vi.stubGlobal(
			'fetch',
			replying((n) => '```json\n' + all('FILM', 'SAME_TITLE')(n) + '\n```')
		);
		const result = await classifyFilenames('key', movie, ['x']);
		expect(result.answers).toEqual([{ media: 'FILM', titleMatch: 'SAME_TITLE' }]);
	});

	it('refuses an answer outside the offered choices rather than guessing', async () => {
		vi.stubGlobal('fetch', replying(all('MAYBE', 'SAME_TITLE')));
		await expect(classifyFilenames('key', movie, ['x'])).rejects.toThrow('outside the offered');
	});

	it('refuses a reply that skips a filename', async () => {
		vi.stubGlobal(
			'fetch',
			replying(() => all('FILM', 'SAME_TITLE')(1))
		);
		await expect(classifyFilenames('key', movie, ['x', 'y'])).rejects.toThrow(
			'outside the offered'
		);
	});

	it('refuses a reply that is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			replying(() => 'I cannot help with that.')
		);
		await expect(classifyFilenames('key', movie, ['x'])).rejects.toThrow(
			'did not reply with JSON'
		);
	});

	it('fails on an HTTP error', async () => {
		vi.stubGlobal('fetch', replying(all('FILM', 'SAME_TITLE'), 402));
		await expect(classifyFilenames('key', movie, ['x'])).rejects.toThrow('HTTP 402');
	});

	it('is switched on by its own key only', () => {
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', '');
		vi.stubEnv('TYPESAFE_API_KEY', 'old-key');
		expect(modelKey()).toBeUndefined();
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', 'sk-test');
		expect(modelKey()).toBe('sk-test');
	});
});
