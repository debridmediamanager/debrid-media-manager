import { createUsenetDownload } from '@/services/torbox';
import type { TorBoxCreateUsenetDownloadResponse, TorBoxResponse } from '@/services/types';
import { fetchCleanNzb } from '@/utils/nzbDownload';

/**
 * Where TorBox put a posted NZB: a download it already held (`cached`, ready at
 * once), a new one it is fetching (`started`), or one waiting for a free
 * active slot (`queued`). TorBox says "cached" only in `detail`.
 */
export type TorBoxUsenetSend =
	{ kind: 'cached' | 'started'; usenetId: number } | { kind: 'queued'; queuedId: number };

type Refusal = Pick<TorBoxResponse<unknown>, 'error' | 'detail'> | undefined;

function describeRefusal(body: Refusal, fallback: string): string {
	if (body?.error === 'PLAN_RESTRICTED_FEATURE') return 'TorBox Usenet needs a Pro plan';
	return body?.detail || (typeof body?.error === 'string' ? body.error : '') || fallback;
}

/**
 * Sends one search result to the member's TorBox Usenet downloads. The NZB is
 * the cleaned one DMM's server fetches (the indexer key never reaches the
 * browser), and the browser posts it with the member's own TorBox key.
 */
export async function sendNzbToTorBox(
	tbKey: string,
	id: string,
	title: string
): Promise<TorBoxUsenetSend> {
	const { blob, name } = await fetchCleanNzb(id, title);
	const file = new File([blob], name, { type: 'application/x-nzb' });

	let answer: TorBoxResponse<TorBoxCreateUsenetDownloadResponse | null>;
	try {
		answer = await createUsenetDownload(tbKey, { file, name: name.replace(/\.nzb$/i, '') });
	} catch (error) {
		const body = (error as { response?: { data?: Refusal } }).response?.data;
		throw new Error(
			describeRefusal(body, error instanceof Error ? error.message : 'TorBox refused it')
		);
	}

	if (!answer.success) throw new Error(describeRefusal(answer, 'TorBox refused it'));
	if (answer.data?.queued_id) return { kind: 'queued', queuedId: answer.data.queued_id };
	if (answer.data?.usenetdownload_id) {
		return {
			kind: /cached/i.test(answer.detail ?? '') ? 'cached' : 'started',
			usenetId: answer.data.usenetdownload_id,
		};
	}
	throw new Error('TorBox answered without a download');
}
