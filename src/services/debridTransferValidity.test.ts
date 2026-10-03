import { isTransferStillValid } from '@/services/debridTransferValidity';
import { repository as db } from '@/services/repository';
import cancelledDownloading from '@/test/fixtures/debridUploader/job-cancelled-downloading.json';
import cancelledPending from '@/test/fixtures/debridUploader/job-cancelled-pending.json';
import cancelledUploading from '@/test/fixtures/debridUploader/job-cancelled-uploading.json';
import cancelledMappings from '@/test/fixtures/debridUploader/tbrd-cancelled-mappings.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const SERVER = 'http://100.122.58.7:3100';

const uploaderAnswers = (body: unknown) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
	);

beforeEach(() => {
	vi.clearAllMocks();
	process.env.DEBRID_UPLOADER_URLS = SERVER;
	vi.mocked(db).getDebridJobServer = vi.fn().mockResolvedValue(SERVER);
});

// The question every new send of a release asks first: is a transfer of it
// already under way? A yes refuses the send for every user, so a job that has
// ended must never answer it.
describe('isTransferStillValid on a pending mapping', () => {
	// Card 109. Production mappings and the uploader's answers for their jobs,
	// 2026-10-03. Each job had been cancelled and still reported its last stage,
	// which this read as a live transfer: "transfer in progress — waiting for
	// completion", and then nothing, for everyone who tried that release.
	const cases = [
		[cancelledMappings[0], cancelledUploading],
		[cancelledMappings[1], cancelledPending],
		[cancelledMappings[2], cancelledDownloading],
	] as const;

	for (const [mapping, job] of cases) {
		it(`does not hold a release for a job cancelled while ${job.status}`, async () => {
			expect(mapping.jobId).toBe(job.id);
			uploaderAnswers(job);

			expect(await isTransferStillValid(mapping)).toBe(false);
		});
	}

	it('holds a release for a job still running', async () => {
		uploaderAnswers({ ...cancelledUploading, deleted: 0 });

		expect(await isTransferStillValid(cancelledMappings[0])).toBe(true);
	});
});
