/**
 * Asks the verdict model about every waiting report it never judged, so the queue at
 * /admin/reports can be sorted by "model agrees" / "model disagrees". It only files
 * the model's verdict (`jev:confirmed` / `jev:disputed`); nothing is hidden or kept.
 * Only wrong-title and adult reports are judged, as for new reports.
 *
 * Runs DeepSeek v4.1 Flash with reasoning off (98.8% on the 600 labelled names, the
 * same as Jev) and counts its tokens against the daily verdict budget, stopping when
 * that is spent.
 *
 *   OPENROUTER_VERDICTS_KEY=… DATABASE_URL=… npx tsx scripts/review-reported-backlog.ts \
 *     [--apply] [--limit N] [--concurrency N]
 *
 * Without --apply it is a dry run: it asks about --limit titles (default 10), prints
 * what it would file and writes nothing, not even the token count.
 */
import { PrismaClient } from '@prisma/client';
import { ScrapedVerdictService } from '../src/services/database/scrapedVerdict';
import { JEV_DISPUTED, JEV_REPORTER, type ReportType } from '../src/services/reporterId';
import { underBudget } from '../src/services/scrapedVerdicts/job';
import { reviewReports, type ModelVerdict } from '../src/services/scrapedVerdicts/reports';

const MODEL = 'deepseek/deepseek-v4.1-flash-1017';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: number) => {
	const at = args.indexOf(name);
	const value = at === -1 ? NaN : Number(args[at + 1]);
	return Number.isInteger(value) && value > 0 ? value : fallback;
};
const apply = flag('--apply');
const limit = option('--limit', apply ? Infinity : 10);
const concurrency = option('--concurrency', 3);

type Group = { imdbId: string; type: ReportType; hashes: string[] };

async function waitingGroups(prisma: PrismaClient): Promise<Group[]> {
	// Waiting pairs the model has no entry on, one row per person's judgeable report.
	const rows = await prisma.$queryRaw<{ imdbId: string; type: ReportType; hash: string }[]>`
		SELECT r.imdbId, r.type, r.hash, MAX(r.createdAt) AS lastAt
		FROM Report r
		JOIN (
			SELECT r2.imdbId, r2.hash
			FROM Report r2
			LEFT JOIN ReportDecision d ON d.imdbId = r2.imdbId AND d.hash = r2.hash
			WHERE d.hash IS NULL
			GROUP BY r2.imdbId, r2.hash
			HAVING SUM(r2.userId IN (${JEV_REPORTER}, ${JEV_DISPUTED})) = 0
		) p ON p.imdbId = r.imdbId AND p.hash = r.hash
		WHERE r.type IN ('porn', 'wrong_imdb') AND r.userId NOT LIKE 'jev:%'
		GROUP BY r.imdbId, r.type, r.hash
		ORDER BY lastAt DESC`;
	const groups = new Map<string, Group>();
	for (const { imdbId, type, hash } of rows) {
		const key = `${imdbId}|${type}`;
		const group = groups.get(key) ?? { imdbId, type, hashes: [] };
		group.hashes.push(hash);
		groups.set(key, group);
	}
	return [...groups.values()];
}

async function main() {
	if (!process.env.OPENROUTER_VERDICTS_KEY) throw new Error('OPENROUTER_VERDICTS_KEY is not set');
	const prisma = new PrismaClient();
	const verdicts = new ScrapedVerdictService();
	let tokens = 0;
	// A dry run must not even move the day's token count.
	const db = new Proxy(verdicts, {
		get(target, prop, receiver) {
			if (prop === 'addTokensSpent') {
				return async (day: string, spent: number) => {
					tokens += spent;
					if (apply) await target.addTokensSpent(day, spent);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	const all = await waitingGroups(prisma);
	const groups = all.slice(0, limit);
	console.log(
		`${apply ? 'APPLY' : 'DRY RUN'}: ${all.length} title/type groups, ${all.reduce((n, g) => n + g.hashes.length, 0)} releases waiting unjudged; doing ${groups.length} with ${MODEL}`
	);

	const filed = { confirmed: 0, disputed: 0 };
	let unjudged = 0;
	let done = 0;
	let stopped = false;
	const queue = [...groups];

	async function worker() {
		while (queue.length > 0 && !stopped) {
			if (!(await underBudget(verdicts))) {
				stopped = true;
				console.log(
					'Daily verdict budget spent; stopping. Run again tomorrow to continue.'
				);
				return;
			}
			const group = queue.shift()!;
			const names = apply ? null : await verdicts.getFilenames(group.imdbId, group.hashes);
			let judged = 0;
			const record = async (hash: string, verdict: ModelVerdict) => {
				filed[verdict] += 1;
				judged += 1;
				if (apply) {
					await prisma.report.upsert({
						where: {
							hash_userId: {
								hash,
								userId: verdict === 'confirmed' ? JEV_REPORTER : JEV_DISPUTED,
							},
						},
						update: { type: group.type, createdAt: new Date() },
						create: {
							hash,
							imdbId: group.imdbId,
							userId: verdict === 'confirmed' ? JEV_REPORTER : JEV_DISPUTED,
							type: group.type,
						},
					});
				} else {
					console.log(
						`  ${group.imdbId} ${group.type} ${hash.slice(0, 12)} ${verdict.padEnd(9)} ${names?.get(hash) ?? '(no name)'}`
					);
				}
			};
			try {
				await reviewReports(group.imdbId, group.hashes, group.type, db, record, {
					model: MODEL,
				});
			} catch (error) {
				console.warn(
					`  ${group.imdbId} ${group.type}: ${error instanceof Error ? error.message : error}`
				);
			}
			unjudged += group.hashes.length - judged;
			done += 1;
			if (done % 50 === 0) {
				console.log(
					`${done}/${groups.length} groups, confirmed ${filed.confirmed}, disputed ${filed.disputed}, unjudged ${unjudged}, ${tokens} tokens`
				);
			}
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker));
	console.log(
		`Done ${done}/${groups.length} groups: confirmed ${filed.confirmed}, disputed ${filed.disputed}, unjudged ${unjudged} (no name or no answer), ${tokens} tokens${apply ? '' : ' (dry run: nothing written)'}`
	);
	await prisma.$disconnect();
	await verdicts.disconnect();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
