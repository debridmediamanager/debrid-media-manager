/** Shared progress is public; provider identities, torrent ids and internal paths are not. */
export function publicDebridJob(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	const job = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of ['id', 'status', 'status_message', 'error', 'info_hash', 'name', 'source']) {
		if (typeof job[key] === 'string' || job[key] === null) result[key] = job[key];
	}
	if (typeof job.dmm_registered === 'boolean') result.dmm_registered = job.dmm_registered;
	if (job.queue && typeof job.queue === 'object') {
		const queue = job.queue as Record<string, unknown>;
		if (typeof queue.position === 'number' && typeof queue.waiting === 'number') {
			result.queue = { position: queue.position, waiting: queue.waiting };
		}
	}
	return result;
}
