import { getSiteSetting } from '@/services/siteSettings';

// What is inside a reported torrent, for /admin/reports. Tried in order, first answer wins:
// Premiumize (directdl: files and play links, nothing added to the account), Real-Debrid
// (the file list only, see below) and TorBox (its cache check lists files, no slot used).

export type InspectedFile = {
	path: string;
	size: number;
	link: string | null;
	streamLink: string | null;
};
export type InspectProvider = 'premiumize' | 'realdebrid' | 'torbox';
export type Inspection = {
	cached: boolean;
	provider: InspectProvider | null;
	files: InspectedFile[];
};

const TIMEOUT_MS = 30_000;
const RD = 'https://api.real-debrid.com/rest/1.0';
/** Real-Debrid fills a cached magnet's file list at once; an unknown one stays empty. */
const RD_POLLS = 6;
const RD_POLL_MS = 750;
const RD_DONE = new Set(['magnet_error', 'error', 'virus', 'dead']);

const bySize = (files: InspectedFile[]) => files.sort((a, b) => b.size - a.size);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function premiumize(key: string, hash: string): Promise<InspectedFile[] | null> {
	const response = await fetch('https://www.premiumize.me/api/transfer/directdl', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({ src: `magnet:?xt=urn:btih:${hash}` }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const answer = (await response.json()) as {
		status?: string;
		content?: { path: string; size?: number; link: string; stream_link?: string | null }[];
	};
	if (answer.status !== 'success') return null;
	return (answer.content ?? []).map((file) => ({
		path: file.path,
		size: file.size ?? 0,
		link: file.link,
		streamLink: file.stream_link ?? null,
	}));
}

/**
 * Adds the magnet, reads its file list and deletes it again, without selecting files or
 * making links. Real-Debrid records which IP downloads each link and an account must stay
 * on one IP, so links made here could never be played from the admin's own browser.
 */
async function realDebrid(key: string, hash: string): Promise<InspectedFile[] | null> {
	const headers = { Authorization: `Bearer ${key}` };
	const added = await fetch(`${RD}/torrents/addMagnet`, {
		method: 'POST',
		headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const { id } = (await added.json()) as { id?: string };
	if (!id) return null;
	try {
		for (let poll = 0; poll < RD_POLLS; poll++) {
			if (poll > 0) await sleep(RD_POLL_MS);
			const info = (await (
				await fetch(`${RD}/torrents/info/${id}`, {
					headers,
					signal: AbortSignal.timeout(TIMEOUT_MS),
				})
			).json()) as { status?: string; files?: { path: string; bytes?: number }[] };
			if (info.files?.length) {
				return info.files.map((file) => ({
					path: file.path.replace(/^\/+/, ''),
					size: file.bytes ?? 0,
					link: null,
					streamLink: null,
				}));
			}
			if (info.status && RD_DONE.has(info.status)) return null;
		}
		return null;
	} finally {
		await fetch(`${RD}/torrents/delete/${id}`, {
			method: 'DELETE',
			headers,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		}).catch((error) => console.error(`inspect: could not delete RD torrent ${id}:`, error));
	}
}

async function torBox(key: string, hash: string): Promise<InspectedFile[] | null> {
	const response = await fetch(
		`https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash}&format=list&list_files=true`,
		{ headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
	);
	const answer = (await response.json()) as {
		success?: boolean;
		data?: { files?: { name: string; size?: number }[] }[];
	};
	const files = answer.data?.[0]?.files;
	if (!answer.success || !files?.length) return null;
	return files.map((file) => ({
		path: file.name,
		size: file.size ?? 0,
		link: null,
		streamLink: null,
	}));
}

const CHAIN = [
	['premiumize', 'inspectPremiumizeKey', premiumize],
	['realdebrid', 'inspectRealDebridKey', realDebrid],
	['torbox', 'inspectTorBoxKey', torBox],
] as const;

/** null when no provider key is set at all. */
export async function inspectRelease(hash: string): Promise<Inspection | null> {
	let anyKey = false;
	for (const [provider, setting, look] of CHAIN) {
		const key = await getSiteSetting(setting);
		if (!key) continue;
		anyKey = true;
		const files = await look(key, hash).catch((error) => {
			console.error(
				`inspect: ${provider} failed for ${hash}:`,
				error instanceof Error ? error.message : error
			);
			return null;
		});
		if (files?.length) return { cached: true, provider, files: bySize(files) };
	}
	return anyKey ? { cached: false, provider: null, files: [] } : null;
}
