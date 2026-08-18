import { repository as db } from '@/services/repository';
import { trapsForRotation } from '@/utils/canary';
import { NextApiHandler } from 'next';

const ORIGIN = process.env.DMM_ORIGIN || 'https://debridmediamanager.com';
const CACHE_MS = 15 * 60 * 1000;

const STATIC_PATHS = ['/', '/browse/recent', '/browse/top', '/search', '/music'];

let cache: { at: number; body: string } | null = null;

export function clearSitemapCache(): void {
	cache = null;
}

function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Spreads the trap urls through the real ones. A block of unfamiliar ids at the
 * end of the file is a tell; interleaved they read as ordinary entries.
 */
function interleave(real: string[], traps: string[]): string[] {
	if (traps.length === 0) return real;
	const step = Math.max(1, Math.floor(real.length / traps.length));
	const out: string[] = [];
	let trapIndex = 0;
	for (let i = 0; i < real.length; i++) {
		out.push(real[i]);
		if (trapIndex < traps.length && (i + 1) % step === 0) {
			out.push(traps[trapIndex++]);
		}
	}
	while (trapIndex < traps.length) out.push(traps[trapIndex++]);
	return out;
}

async function recentPaths(): Promise<string[]> {
	try {
		const keys = await db.getRecentlyUpdatedContent();
		return Array.from(new Set(keys))
			.map((key: string) => {
				const match = /^(movie|tv):(tt\d+)/.exec(key);
				if (!match) return '';
				return `/${match[1] === 'movie' ? 'movie' : 'show'}/${match[2]}`;
			})
			.filter(Boolean);
	} catch {
		// The sitemap is unauthenticated; a database hiccup must not 500 it.
		return [];
	}
}

export async function buildSitemap(now: number = Date.now()): Promise<string> {
	const traps = trapsForRotation(now).map((imdbId) => `/movie/${imdbId}`);
	const paths = interleave([...STATIC_PATHS, ...(await recentPaths())], traps);
	const urls = paths
		.map((path) => `\t<url>\n\t\t<loc>${escapeXml(`${ORIGIN}${path}`)}</loc>\n\t</url>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const handler: NextApiHandler = async (_req, res) => {
	const now = Date.now();
	if (!cache || now - cache.at > CACHE_MS) {
		cache = { at: now, body: await buildSitemap(now) };
	}
	res.setHeader('Content-Type', 'application/xml; charset=utf-8');
	res.setHeader('Cache-Control', 'public, max-age=900');
	res.status(200).send(cache.body);
};

export default handler;
