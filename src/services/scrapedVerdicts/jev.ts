import { MEDIA_CHOICES, TITLE_CHOICES, type Media, type TitleMatch } from './rules';

/**
 * TypeSafe's Jev answers typed choice questions and charges only for input
 * tokens. Each filename gets two narrow questions; a wide prompt that asked for
 * the whole verdict at once measured 92% agreement against 98% for this split.
 */
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Two questions per filename, so 75 filenames per request. */
const QUESTIONS_PER_REQUEST = 150;
const TIMEOUT_MS = 60_000;

export type JevAnswer = { media: Media; titleMatch: TitleMatch };
export type JevResult = { answers: JevAnswer[]; model: string; inputTokens: number };

export class JevError extends Error {}

type ChoiceAnswer = { choice?: unknown };
type SystemOneResponse = {
	model?: string;
	answers?: Record<string, ChoiceAnswer>;
	usage?: { input_tokens?: number };
};

function choiceOf<T extends string>(answer: ChoiceAnswer | undefined, allowed: object): T {
	const choice = answer?.choice;
	if (typeof choice !== 'string' || !Object.hasOwn(allowed, choice)) {
		throw new JevError('Jev returned an answer outside the offered choices');
	}
	return choice as T;
}

async function ask(
	apiKey: string,
	movie: { titles: string[]; year: number },
	filenames: string[]
): Promise<JevResult> {
	const questions: Record<string, unknown> = {};
	filenames.forEach((filename, i) => {
		questions[`m${i}`] = {
			type: 'choice',
			criteria: MEDIA_CHOICES,
			instructions: { filename, question: 'What kind of content is this torrent?' },
		};
		questions[`t${i}`] = {
			type: 'choice',
			criteria: TITLE_CHOICES,
			instructions: {
				filename,
				question:
					"How does the title in this filename relate to the movie's listed titles?",
			},
		};
	});

	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'jev-latest',
			state: { movie: { titles: movie.titles, year: movie.year } },
			questions,
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new JevError(`Jev answered HTTP ${response.status}`);

	const body = (await response.json()) as SystemOneResponse;
	const answers = filenames.map((_, i) => ({
		media: choiceOf<Media>(body.answers?.[`m${i}`], MEDIA_CHOICES),
		titleMatch: choiceOf<TitleMatch>(body.answers?.[`t${i}`], TITLE_CHOICES),
	}));
	return {
		answers,
		model: body.model ?? 'unknown',
		inputTokens: body.usage?.input_tokens ?? 0,
	};
}

/**
 * Classifies filenames in batches. A batch that fails throws; the caller records
 * nothing for it, so those filenames are retried on a later visit rather than
 * receiving a guessed verdict.
 */
export async function classifyFilenames(
	apiKey: string,
	movie: { titles: string[]; year: number },
	filenames: string[]
): Promise<JevResult> {
	const perRequest = QUESTIONS_PER_REQUEST / 2;
	const answers: JevAnswer[] = [];
	let model = 'unknown';
	let inputTokens = 0;
	for (let start = 0; start < filenames.length; start += perRequest) {
		const batch = await ask(apiKey, movie, filenames.slice(start, start + perRequest));
		answers.push(...batch.answers);
		model = batch.model;
		inputTokens += batch.inputTokens;
	}
	return { answers, model, inputTokens };
}
