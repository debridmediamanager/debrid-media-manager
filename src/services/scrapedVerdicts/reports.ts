import { ScrapedVerdictService, titleKeyOf } from '@/services/database/scrapedVerdict';
import { JEV_DISPUTED, JEV_REPORTER, type ReportType } from '@/services/reporterId';
import { repository } from '@/services/repository';
import { identifiedAnswers } from './identified';
import { ENGINE, underBudget, utcDay } from './job';
import { classifyFilenames, modelKey, type ModelOptions } from './model';
import { decide, decideWithoutModel } from './rules';

/**
 * Jev's second opinion on a report, filed under `JEV_REPORTER` and shown on
 * /admin/reports as "model agrees". Since 2026-11-11 nothing is hidden until an
 * admin approves the report there; before that, Jev's agreement (or a second
 * reporter) hid the result on its own.
 *
 * A movie report counts as confirmed when the movie-page verdict trashes the
 * release, reusing a stored verdict where there is one. A series has no tuned
 * rules, so the report is checked against one narrow question: adult content
 * for `porn`, none of the series' titles in the filename for `wrong_imdb`.
 * `wrong_season` is not judged: the report does not say which season is right.
 * Nor is `malware`: real releases carry executables too (every RARBG release
 * ships `RARBG_DO_NOT_MIRROR.exe`), and fakes that are only an executable are
 * already off the page (`withoutExecutables`).
 */
export type { ReportType };

let service: ScrapedVerdictService | undefined;
const verdicts = () => (service ??= new ScrapedVerdictService());

export type ModelVerdict = 'confirmed' | 'disputed';

/**
 * Returns the hashes the identifier or Jev confirmed. Each judged hash is filed:
 * `confirmed` under `JEV_REPORTER`, `disputed` (the release looks right for the
 * title) under `JEV_DISPUTED`. A hash nothing could judge is filed under neither.
 */
export async function reviewReports(
	imdbId: string,
	hashes: string[],
	type: ReportType,
	db?: ScrapedVerdictService,
	file: (hash: string, verdict: ModelVerdict) => Promise<void> = (hash, verdict) =>
		repository.reportContent(
			hash,
			imdbId,
			verdict === 'confirmed' ? JEV_REPORTER : JEV_DISPUTED,
			type
		),
	options: ModelOptions = {}
): Promise<string[]> {
	const key = modelKey();
	if (!key || type === 'wrong_season' || type === 'malware' || hashes.length === 0) return [];
	db ??= verdicts();

	const filenames = await db.getFilenames(imdbId, hashes);
	if (filenames.size === 0) return [];
	const reported = [...filenames];

	const confirmed: string[] = [];
	const disputed: string[] = [];
	const judged = (hash: string, trash: boolean) => (trash ? confirmed : disputed).push(hash);
	const movie = await db.getMovieContext(imdbId);
	if (movie) {
		const stored = new Map((await db.getVerdicts(imdbId)).map((v) => [v.titleKey, v.verdict]));
		let forModel: [string, string][] = [];
		for (const [hash, title] of reported) {
			const settled = stored.get(titleKeyOf(title)) ?? decideWithoutModel(movie, title);
			if (settled) judged(hash, settled === 'trash');
			else forModel.push([hash, title]);
		}
		// a report's few names fit one pass, so none is deferred in practice
		const { answers: identified } = await identifiedAnswers(
			movie,
			forModel.map(([, title]) => title)
		);
		for (const [hash, title] of forModel) {
			const answer = identified.get(title);
			if (answer)
				judged(hash, decide(movie, title, answer.media, answer.titleMatch) === 'trash');
		}
		forModel = forModel.filter(([, title]) => !identified.has(title));
		if (forModel.length > 0 && (await underBudget(db))) {
			const result = await classifyFilenames(
				key,
				movie,
				forModel.map(([, title]) => title),
				options
			);
			await db.addTokensSpent(utcDay(), result.tokens);
			forModel.forEach(([hash, title], i) => {
				const answer = result.answers[i];
				if (answer)
					judged(hash, decide(movie, title, answer.media, answer.titleMatch) === 'trash');
			});
		}
	} else {
		const show = await db.getShowTitles(imdbId);
		if (!show || !(await underBudget(db))) return [];
		const result = await classifyFilenames(
			key,
			show,
			reported.map(([, title]) => title),
			options
		);
		await db.addTokensSpent(utcDay(), result.tokens);
		reported.forEach(([hash], i) => {
			const answer = result.answers[i];
			if (!answer) return;
			judged(
				hash,
				type === 'porn' ? answer.media === 'ADULT' : answer.titleMatch === 'NO_TITLE'
			);
		});
	}

	for (const hash of confirmed) await file(hash, 'confirmed');
	for (const hash of disputed) await file(hash, 'disputed');
	if (confirmed.length + disputed.length > 0) {
		console.log(
			`[reports] ${imdbId}: model confirmed ${confirmed.length}, disputed ${disputed.length} ${type} (${options.model ?? ENGINE})`
		);
	}
	return confirmed;
}

/** Fire-and-forget from the report routes; a failed review leaves the reports as filed. */
export function reviewReportsInBackground(imdbId: string, hashes: string[], type: ReportType) {
	reviewReports(imdbId, hashes, type).catch((error) =>
		console.warn(
			`[reports] review of ${imdbId} failed:`,
			error instanceof Error ? error.message : error
		)
	);
}
