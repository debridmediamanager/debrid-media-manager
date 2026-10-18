import { ScrapedVerdictService, titleKeyOf } from '@/services/database/scrapedVerdict';
import { JEV_REPORTER, type ReportType } from '@/services/reporterId';
import { repository } from '@/services/repository';
import { identifiedAnswers } from './identified';
import { classifyFilenames } from './jev';
import { ENGINE, underBudget, utcDay } from './job';
import { decide, decideWithoutModel } from './rules';

/**
 * A single report hides a result for everyone only once Jev agrees with it;
 * otherwise it takes two reporters. This replaced a moderator whose reporter id
 * was compared in the public source, so anyone could send it.
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

/** Returns the hashes the identifier or Jev confirmed, after filing each under `JEV_REPORTER`. */
export async function reviewReports(
	imdbId: string,
	hashes: string[],
	type: ReportType,
	db?: ScrapedVerdictService,
	file: (hash: string) => Promise<void> = (hash) =>
		repository.reportContent(hash, imdbId, JEV_REPORTER, type)
): Promise<string[]> {
	const key = process.env.TYPESAFE_API_KEY;
	if (!key || type === 'wrong_season' || type === 'malware' || hashes.length === 0) return [];
	db ??= verdicts();

	const filenames = await db.getFilenames(imdbId, hashes);
	if (filenames.size === 0) return [];
	const reported = [...filenames];

	const confirmed: string[] = [];
	const movie = await db.getMovieContext(imdbId);
	if (movie) {
		const stored = new Map((await db.getVerdicts(imdbId)).map((v) => [v.titleKey, v.verdict]));
		let forModel: [string, string][] = [];
		for (const [hash, title] of reported) {
			const settled = stored.get(titleKeyOf(title)) ?? decideWithoutModel(movie, title);
			if (settled === 'trash') confirmed.push(hash);
			else if (!settled) forModel.push([hash, title]);
		}
		// a report's few names fit one pass, so none is deferred in practice
		const { answers: identified } = await identifiedAnswers(
			movie,
			forModel.map(([, title]) => title)
		);
		for (const [hash, title] of forModel) {
			const answer = identified.get(title);
			if (answer && decide(movie, title, answer.media, answer.titleMatch) === 'trash') {
				confirmed.push(hash);
			}
		}
		forModel = forModel.filter(([, title]) => !identified.has(title));
		if (forModel.length > 0 && (await underBudget(db))) {
			const result = await classifyFilenames(
				key,
				movie,
				forModel.map(([, title]) => title)
			);
			await db.addTokensSpent(utcDay(), result.inputTokens);
			forModel.forEach(([hash, title], i) => {
				const { media, titleMatch } = result.answers[i];
				if (decide(movie, title, media, titleMatch) === 'trash') confirmed.push(hash);
			});
		}
	} else {
		const show = await db.getShowTitles(imdbId);
		if (!show || !(await underBudget(db))) return [];
		const result = await classifyFilenames(
			key,
			show,
			reported.map(([, title]) => title)
		);
		await db.addTokensSpent(utcDay(), result.inputTokens);
		reported.forEach(([hash], i) => {
			const { media, titleMatch } = result.answers[i];
			if (type === 'porn' ? media === 'ADULT' : titleMatch === 'NO_TITLE') {
				confirmed.push(hash);
			}
		});
	}

	for (const hash of confirmed) await file(hash);
	if (confirmed.length > 0) {
		console.log(`[reports] ${imdbId}: Jev confirmed ${confirmed.length} ${type} (${ENGINE})`);
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
