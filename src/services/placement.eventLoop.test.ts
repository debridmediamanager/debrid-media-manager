import tmnt from '@/test/fixtures/placement/tmnt-1987-pack-on-2003-series.json';
import { describe, expect, it } from 'vitest';
import { placeReleases, type PlaceRequest, type PlacementSources } from './placement';

const r: any = tmnt.answers;
const known: Record<string, (...args: any[]) => Promise<unknown>> = {
	find: async (id: string) => r.find[id] ?? null,
	show: async (id: number) => r.show[id] ?? null,
	season: async (id: number, n: number) => r.season[`${id}/${n}`] ?? null,
	seasonEpisodes: async () => new Map(),
	identifier: async () => new Map(),
};
/** What the fixture recorded; every other source answers nothing. */
const sources = new Proxy(known, {
	get: (target, key: string) => target[key] ?? (async () => null),
}) as unknown as PlacementSources;

describe('placement and the event loop', () => {
	// On 2026-11-11 a placement held a dmm_web replica for 12.4 s without a break: its awaits were
	// on cached answers, which run as microtasks, so no request or health probe got in.
	it('lets other work run while it places a batch of packs', async () => {
		const batch = Array.from({ length: 5 }, () => tmnt.request as PlaceRequest);
		let last = performance.now();
		let longest = 0;
		const ticker = setInterval(() => {
			const now = performance.now();
			longest = Math.max(longest, now - last);
			last = now;
		}, 1);
		const started = performance.now();
		const { releases } = await placeReleases(
			batch,
			async (list) => list.map(() => null),
			sources,
			Infinity
		);
		const took = performance.now() - started;
		clearInterval(ticker);
		longest = Math.max(longest, performance.now() - last);

		expect(releases).toHaveLength(5);
		expect(took).toBeGreaterThan(200); // enough work that holding the loop throughout would show
		expect(longest).toBeLessThan(100);
	}, 60_000);
});
