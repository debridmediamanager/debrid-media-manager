import { _testing as dlTesting } from '@/services/debridLink';
import verity from '@/test/fixtures/debridlink/seedbox-add-verity-2026-11-04.json';
import { vi } from 'vitest';

/**
 * DMM's Debrid-Link probe account as recorded on 2026-11-04: each bare-hash add answers as
 * `seedbox-add-verity-2026-11-04.json` holds it, a hit stays in the account until removed.
 * Returns the calls made and what the account holds.
 */
export function stubDlProbeAccount(alreadyHeld: any[] = []) {
	process.env.DEBRIDLINK_PROBE_KEY = 'dmm-probe-key';
	dlTesting.resetLibrarySnapshots();
	dlTesting.resetProbeBudget();
	dlTesting.resetFloodLockouts();
	const adds = new Map(verity.adds.map((a) => [a.hash, a]));
	const calls: { method: string; url: string }[] = [];
	const held = new Map<string, any>(alreadyHeld.map((t) => [t.id, t]));
	const json = (status: number, payload: unknown) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit = {}) => {
			const method = init.method ?? 'GET';
			calls.push({ method, url });
			if (url.includes('/seedbox/add')) {
				const add = adds.get(new URLSearchParams(String(init.body)).get('url')!);
				if (!add) throw new Error(`no recorded add for ${init.body}`);
				if (add.status === 200) {
					const torrent = (add.body as any).value;
					held.set(torrent.id, torrent);
				}
				return json(add.status, add.body);
			}
			if (url.includes('/remove')) {
				const ids = decodeURIComponent(url.split('/seedbox/')[1].split('/remove')[0]).split(
					','
				);
				ids.forEach((id) => held.delete(id));
				return json(200, { success: true, value: ids });
			}
			if (url.includes('/seedbox/list')) {
				const ids = new URL(url).searchParams.get('ids')?.split(',');
				const value = [...held.values()].filter((t) => !ids || ids.includes(t.id));
				return json(200, { ...verity.emptyListing, value });
			}
			throw new Error(`unexpected Debrid-Link call ${method} ${url}`);
		})
	);
	return { calls, held };
}

export const unstubDlProbeAccount = () => {
	delete process.env.DEBRIDLINK_PROBE_KEY;
	vi.unstubAllGlobals();
};

/** Recorded adds: whole hits, the one admitted at 27%, and misses. */
const value = (a: (typeof verity.adds)[number]) => (a.body as any).value;
export const verityWhole = verity.adds.filter(
	(a) => a.status === 200 && value(a).downloadPercent === 100
);
export const verityPartial = verity.adds.find(
	(a) => a.status === 200 && value(a).downloadPercent < 100
)!;
export const verityMiss = verity.adds.filter((a) => a.status !== 200);
