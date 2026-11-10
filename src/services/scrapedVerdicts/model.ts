import { MEDIA_CHOICES, TITLE_CHOICES, type Media, type TitleMatch } from './rules';

/**
 * Gemma 4 26B through OpenRouter answers the two narrow questions per filename
 * that TypeSafe's Jev answered until 2026-11-10. On the 600 labelled filenames
 * it deleted as few real releases as Jev (1.3%) and left 3.1% of the junk
 * (Jev 1.4%), at a third of Jev's cost: about $0.0074 per 1,000 filenames.
 * The movie's titles go once per request and the filenames are numbered, so a
 * filename costs about 50 input and 19 output tokens instead of Jev's 478.
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const MODEL = 'google/gemma-4-26b-a4b-it';
/** The batch size measured on the labelled filenames. */
const FILENAMES_PER_REQUEST = 40;
const TIMEOUT_MS = 60_000;

const SYSTEM = [
	"You label torrent filenames found on a movie's page. For every numbered filename answer two questions.",
	'media: What kind of content is this torrent? One of:',
	...Object.entries(MEDIA_CHOICES).map(([key, text]) => `- ${key}: ${text}`),
	'',
	"title: How does the title in this filename relate to the movie's listed titles? One of:",
	...Object.entries(TITLE_CHOICES).map(([key, text]) => `- ${key}: ${text}`),
	'',
	'Reply with JSON only: {"1": {"media": "<KEY>", "title": "<KEY>"}, "2": ...}, one entry per filename, keys exactly as listed.',
].join('\n');

/** The model is on whenever its key is set; unsetting it turns every verdict path off. */
export function modelKey(): string | undefined {
	return process.env.OPENROUTER_VERDICTS_KEY || undefined;
}

export type ModelAnswer = { media: Media; titleMatch: TitleMatch };
/** `tokens` counts input and output: unlike Jev, OpenRouter bills both. */
/**
 * `null` where the model gave no valid answer for a filename: Gemma once answered
 * a mojibake name's title question with UNCLEAR. That filename stays unjudged;
 * the rest of its batch is used.
 */
export type ModelResult = { answers: (ModelAnswer | null)[]; model: string; tokens: number };

export class ModelError extends Error {}

type ChatResponse = {
	model?: string;
	choices?: { message?: { content?: string } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const offered = (value: unknown, allowed: object) =>
	typeof value === 'string' && Object.hasOwn(allowed, value);

async function ask(
	apiKey: string,
	movie: { titles: string[]; year: number },
	filenames: string[]
): Promise<ModelResult> {
	const user = [
		'Movie titles:',
		...movie.titles.map((t) => `- ${t}`),
		`Movie year: ${movie.year}`,
		'',
		'Filenames:',
		...filenames.map((f, i) => `${i + 1}. ${f}`),
	].join('\n');

	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM },
				{ role: 'user', content: user },
			],
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new ModelError(`OpenRouter answered HTTP ${response.status}`);

	const body = (await response.json()) as ChatResponse;
	const text = body.choices?.[0]?.message?.content ?? '';
	let parsed: Record<string, { media?: unknown; title?: unknown }>;
	try {
		// some providers wrap the object in a code fence despite response_format
		parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
	} catch {
		throw new ModelError('the model did not reply with JSON');
	}
	const answers = filenames.map((_, i) => {
		const answer = parsed[String(i + 1)];
		if (!offered(answer?.media, MEDIA_CHOICES) || !offered(answer?.title, TITLE_CHOICES)) {
			return null;
		}
		return { media: answer.media as Media, titleMatch: answer.title as TitleMatch };
	});
	return {
		answers,
		model: body.model ?? MODEL,
		tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0),
	};
}

/**
 * Classifies filenames in batches. A batch that fails throws; the caller records
 * nothing for it, so those filenames are retried on a later visit rather than
 * receiving a guessed verdict. A single invalid answer only nulls its filename.
 */
export async function classifyFilenames(
	apiKey: string,
	movie: { titles: string[]; year: number },
	filenames: string[]
): Promise<ModelResult> {
	const answers: (ModelAnswer | null)[] = [];
	let model = MODEL;
	let tokens = 0;
	for (let start = 0; start < filenames.length; start += FILENAMES_PER_REQUEST) {
		const batch = await ask(
			apiKey,
			movie,
			filenames.slice(start, start + FILENAMES_PER_REQUEST)
		);
		answers.push(...batch.answers);
		model = batch.model;
		tokens += batch.tokens;
	}
	return { answers, model, tokens };
}
