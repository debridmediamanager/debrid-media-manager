import { isRdBlockedName } from './deInfringe';

/**
 * Whether Real-Debrid refuses this name: the torrent's own name when it is
 * added, a file's name when its link is unrestricted. One rule, measured
 * against the live service and kept in `deInfringe.ts`; this used to carry its
 * own copy of the list, which went stale when RD changed it.
 */
export function isRdBlockedFilename(filename: string): boolean {
	return isRdBlockedName(filename);
}

/**
 * Why a cast of this RD download URL would never show in Stremio, or null.
 * The stream route drops RD-blocked names, and RD refuses them when the viewer
 * plays, even when the unrestrict done while casting happened to pass.
 */
export function rdBlockedCastMessage(streamUrl: string): string | null {
	let name = streamUrl.split('/').pop() ?? '';
	try {
		name = decodeURIComponent(name);
	} catch {}
	return isRdBlockedFilename(name)
		? `Real-Debrid refuses to stream ${name} because of a tag in its name, so it would never show in Stremio. Pick another release.`
		: null;
}

/**
 * The search toast's count. "Hide Real-Debrid blocked torrents" takes rows off
 * the list after they are counted, so say how many, or "24 found" sits over a
 * list of 6 with no hint why.
 */
export function foundTorrentsMessage(found: number, hiddenByRdNames: number): string {
	if (found === 0) return 'No torrents found';
	if (hiddenByRdNames <= 0) return `${found} unique torrents found`;
	const shown = found - hiddenByRdNames;
	return `${found} unique torrents found, ${hiddenByRdNames} hidden because Real-Debrid blocks their names (Settings)${shown === 0 ? '' : `, ${shown} shown`}`;
}
