/**
 * Kitsu moved its images from `media.kitsu.io` to `media.kitsu.app`, and the
 * old host now answers 404 for all of them. The `Anime` table was filled
 * before the move: on 2026-09-27, 20,550 of its 33,702 posters pointed at the
 * old host, so every poster `/api/search/anime` handed out was broken. The
 * paths carried over, so the host is all that changes; 10 of 15 sampled rows
 * came back that way, and the rest had been re-hashed since and are gone from
 * both hosts.
 */
const OLD_HOST = /^https?:\/\/media\.kitsu\.io\//i;

export function currentKitsuMediaUrl(url: string): string;
export function currentKitsuMediaUrl(url: string | null): string | null;
export function currentKitsuMediaUrl(url: string | null): string | null {
	return url ? url.replace(OLD_HOST, 'https://media.kitsu.app/') : url;
}
