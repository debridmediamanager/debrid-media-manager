import { createWriteStream } from 'fs';
import { rename, stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

export class DumpDownloadFailure extends Error {}

export interface DownloadOptions {
	fetch?: typeof fetch;
	/** Tries before giving up; a dropped connection or a 5xx/429 is tried again. */
	attempts?: number;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** A status a retry can fix; any other non-2xx (404, 403) fails at once. */
const retryable = (status: number) => status === 429 || status >= 500;

/** Download `url` to `path` through `${path}.part`; returns the size in bytes. */
export async function downloadDump(
	url: string,
	path: string,
	options: DownloadOptions = {}
): Promise<number> {
	const fetchFn = options.fetch ?? fetch;
	const attempts = options.attempts ?? 5;
	const sleep = options.sleep ?? defaultSleep;
	const log = options.log ?? (() => {});
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetchFn(url);
			if (!response.ok || !response.body) {
				const failure = new DumpDownloadFailure(`download answered ${response.status}`);
				if (!retryable(response.status)) throw Object.assign(failure, { final: true });
				throw failure;
			}
			// a stream cut mid-body rejects here, and the next attempt rewrites the .part file
			await pipeline(
				Readable.fromWeb(response.body as WebReadableStream),
				createWriteStream(`${path}.part`)
			);
			await rename(`${path}.part`, path);
			return (await stat(path)).size;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if ((error as { final?: boolean }).final) throw error;
			if (attempt >= attempts) {
				throw new DumpDownloadFailure(`download failed ${attempts} times: ${message}`);
			}
			const wait = 10_000 * 2 ** (attempt - 1);
			log(`download failed (${message}); retry ${attempt} in ${wait / 1000}s`);
			await sleep(wait);
		}
	}
}
