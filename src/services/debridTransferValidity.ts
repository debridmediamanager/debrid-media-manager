import { resolveJobServer } from '@/services/debridUploaderServers';
import { repository as db } from '@/services/repository';

// Is a mapped transfer still worth blocking a fresh submission? A completed one
// counts only while its rewritten torrent is still RD-cached (a pruned one
// should be re-transferable); a pending one only while its job is still alive.
export async function isTransferStillValid(record: {
	status: string;
	jobId: string;
	rewrittenHash?: string;
}): Promise<boolean> {
	if (record.status === 'completed') {
		if (!record.rewrittenHash) return false;
		const available = await db.checkAvailabilityByHashes([record.rewrittenHash]);
		return available.length > 0;
	}
	// pending: alive unless the referenced job has failed or vanished
	try {
		const server = await resolveJobServer(record.jobId, (j) => db.getDebridJobServer(j));
		if (!server) return false;
		const res = await fetch(`${server}/jobs/${record.jobId}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10000),
		});
		if (res.status === 404) return false;
		const job = await res.json();
		return job?.status !== 'failed';
	} catch {
		return false; // can't confirm it's alive — let the resubmit through
	}
}
