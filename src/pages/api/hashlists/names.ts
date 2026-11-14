import type { NextApiRequest, NextApiResponse } from 'next';

// GitHub's contents API lists at most 1,000 entries, so /hashlists only ever
// reached ids 000…–0f6a… of the 15,274 lists the repo held on 2026-11-14. The
// git tree lists them all (truncated only past 100,000 entries).
// ponytail: past 100,000 lists the tree comes back truncated; page by subtree then.
const TREE_URL = 'https://api.github.com/repos/debridmediamanager/hashlists/git/trees/main';
const TTL_MS = 10 * 60 * 1000;

let cached: { names: string[]; at: number } | null = null;

/** Every published hash list page in the hashlists repo, by file name. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!cached || Date.now() - cached.at > TTL_MS) {
		try {
			const token = process.env.GH_PAT;
			const response = await fetch(TREE_URL, {
				headers: {
					Accept: 'application/vnd.github+json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});
			if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
			const { tree } = (await response.json()) as { tree: { path: string; type: string }[] };
			const names = tree
				.filter(
					(e) => e.type === 'blob' && e.path.endsWith('.html') && e.path !== 'index.html'
				)
				.map((e) => e.path);
			cached = { names, at: Date.now() };
		} catch (error) {
			console.error('Failed to list hash lists:', error);
			if (!cached) return res.status(502).json({ error: 'Failed to fetch hashlists' });
			// an older list beats none; ask again after another TTL, not on every request
			cached.at = Date.now();
		}
	}
	res.setHeader('Cache-Control', 'public, max-age=600');
	return res.status(200).json({ names: cached.names });
}
