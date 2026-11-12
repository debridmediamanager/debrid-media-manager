import { deleteMagnet, getMagnetLinks, unlockLink, uploadMagnet } from '@/services/allDebrid';
import { getLocalStorageItem } from '@/utils/browserStorage';

// AllDebrid for /admin/reports, run in the admin's own browser: AllDebrid refuses torrent
// adds from datacenter IPs (NO_SERVER), so dmm-01 cannot do this, while a home browser can,
// and its unlocked links then play from that same browser. The key never leaves the browser.

const KEY = 'dmm:adminAllDebridKey';
const ADDED = 'dmm:adminAllDebridMagnets';
/** Cached magnets stay this long so their links keep playing, then the next use deletes them. */
const KEEP_MS = 6 * 60 * 60 * 1000;

export type AllDebridFile = { path: string; size: number; link: string };

export const readAllDebridKey = () => getLocalStorageItem(KEY) ?? '';
export const saveAllDebridKey = (key: string) => {
	try {
		if (key) localStorage.setItem(KEY, key);
		else localStorage.removeItem(KEY);
	} catch {
		// A private window keeps it for this visit only.
	}
};

type Added = { id: number; at: number };
const readAdded = (): Added[] => {
	try {
		return JSON.parse(getLocalStorageItem(ADDED) ?? '[]');
	} catch {
		return [];
	}
};
const writeAdded = (added: Added[]) => {
	try {
		localStorage.setItem(ADDED, JSON.stringify(added));
	} catch {}
};

async function sweep(key: string) {
	const now = Date.now();
	const added = readAdded();
	for (const magnet of added.filter((m) => now - m.at > KEEP_MS)) {
		await deleteMagnet(key, String(magnet.id)).catch(() => {});
	}
	writeAdded(added.filter((m) => now - m.at <= KEEP_MS));
}

export async function lookInsideAllDebrid(
	key: string,
	hash: string
): Promise<{ cached: boolean; files: AllDebridFile[] }> {
	await sweep(key);
	const magnet = (await uploadMagnet(key, [hash])).magnets[0];
	if (!magnet?.id) throw new Error(magnet?.error?.message ?? 'AllDebrid refused the magnet');
	if (!magnet.ready) {
		await deleteMagnet(key, String(magnet.id)).catch(() => {});
		return { cached: false, files: [] };
	}
	writeAdded([...readAdded(), { id: magnet.id, at: Date.now() }]);
	const links = await getMagnetLinks(key, magnet.id);
	return {
		cached: true,
		files: links
			.map((l) => ({ path: l.filename, size: l.size, link: l.link }))
			.sort((a, b) => b.size - a.size),
	};
}

/** Unlocked only on click: each unlock is a real download link for this browser's IP. */
export const playableLink = async (key: string, link: string) => (await unlockLink(key, link)).link;
