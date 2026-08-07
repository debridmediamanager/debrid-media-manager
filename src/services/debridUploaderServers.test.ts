import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getDebridUploaderServers,
	isAllowedServer,
	orderedServersForNewJob,
	resolveJobServer,
} from './debridUploaderServers';

const S1 = 'http://s1:3100';
const S2 = 'http://s2:3100';
const S3 = 'http://s3:3100';

describe('getDebridUploaderServers', () => {
	afterEach(() => {
		delete process.env.DEBRID_UPLOADER_URLS;
		delete process.env.DEBRID_UPLOADER_URL;
	});

	it('parses a comma-separated pool and strips trailing slashes', () => {
		process.env.DEBRID_UPLOADER_URLS = `${S1}/ , ${S2} `;
		expect(getDebridUploaderServers()).toEqual([S1, S2]);
	});

	it('falls back to the single URL var', () => {
		process.env.DEBRID_UPLOADER_URL = `${S2}/`;
		expect(getDebridUploaderServers()).toEqual([S2]);
	});

	it('defaults to debrid02 over Tailscale when nothing is set', () => {
		// Never the public IP: that vhost serves only /webseed/* and 404s /jobs.
		expect(getDebridUploaderServers()).toEqual(['http://100.122.58.7:3100']);
	});

	it('prefers the pool var over the single var', () => {
		process.env.DEBRID_UPLOADER_URLS = `${S1},${S2}`;
		process.env.DEBRID_UPLOADER_URL = S3;
		expect(getDebridUploaderServers()).toEqual([S1, S2]);
	});

	it('validates membership', () => {
		process.env.DEBRID_UPLOADER_URLS = `${S1},${S2}`;
		expect(isAllowedServer(S1)).toBe(true);
		expect(isAllowedServer(S3)).toBe(false);
	});
});

describe('orderedServersForNewJob', () => {
	afterEach(() => delete process.env.DEBRID_UPLOADER_URLS);

	it('rotates so consecutive jobs start on different servers, covering the pool', () => {
		process.env.DEBRID_UPLOADER_URLS = `${S1},${S2},${S3}`;
		const firsts = new Set([
			orderedServersForNewJob()[0],
			orderedServersForNewJob()[0],
			orderedServersForNewJob()[0],
		]);
		// three consecutive picks cover all three servers
		expect(firsts).toEqual(new Set([S1, S2, S3]));
	});

	it('always returns the full pool for failover', () => {
		process.env.DEBRID_UPLOADER_URLS = `${S1},${S2}`;
		expect(orderedServersForNewJob().sort()).toEqual([S1, S2].sort());
	});

	describe('size caps', () => {
		const GB = 1024 ** 3;

		it('parses a ;maxGb cap without polluting the plain URL list', () => {
			process.env.DEBRID_UPLOADER_URLS = `${S1};maxGb=10,${S2}`;
			expect(getDebridUploaderServers()).toEqual([S1, S2]);
			expect(isAllowedServer(S1)).toBe(true);
		});

		it('keeps a job under the cap eligible for the capped server', () => {
			process.env.DEBRID_UPLOADER_URLS = `${S1};maxGb=10`;
			expect(orderedServersForNewJob(5 * GB)).toEqual([S1]);
		});

		it('excludes the capped server for an over-cap job, routing only to the uncapped one', () => {
			process.env.DEBRID_UPLOADER_URLS = `${S1};maxGb=10,${S2}`;
			expect(orderedServersForNewJob(40 * GB)).toEqual([S2]);
		});

		it('skips capped servers when the size is unknown', () => {
			process.env.DEBRID_UPLOADER_URLS = `${S1};maxGb=10,${S2}`;
			expect(orderedServersForNewJob(undefined)).toEqual([S2]);
		});

		it('falls back to the full pool when nothing is eligible', () => {
			process.env.DEBRID_UPLOADER_URLS = `${S1};maxGb=10`;
			expect(orderedServersForNewJob(40 * GB)).toEqual([S1]);
		});
	});
});

describe('resolveJobServer', () => {
	beforeEach(() => {
		process.env.DEBRID_UPLOADER_URLS = `${S1},${S2}`;
	});
	afterEach(() => {
		delete process.env.DEBRID_UPLOADER_URLS;
		vi.restoreAllMocks();
	});

	it('short-circuits to the only server without a lookup when single', async () => {
		process.env.DEBRID_UPLOADER_URLS = S1;
		const getMapped = vi.fn();
		expect(await resolveJobServer('job1', getMapped)).toBe(S1);
		expect(getMapped).not.toHaveBeenCalled();
	});

	it('uses the mapped server when valid', async () => {
		const server = await resolveJobServer('job1', async () => S2);
		expect(server).toBe(S2);
	});

	it('ignores a mapped server no longer in the pool and falls back to fan-out', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async (url: any) => ({ ok: String(url).startsWith(S2) }) as Response
			);
		const server = await resolveJobServer('job1', async () => 'http://gone:3100');
		expect(server).toBe(S2);
		expect(fetchMock).toHaveBeenCalled();
	});

	it('fans out when unmapped and returns whoever answers 200', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
			if (String(url).startsWith(S1)) throw new Error('down');
			return { ok: true } as Response;
		});
		expect(await resolveJobServer('job1', async () => null)).toBe(S2);
	});

	it('returns null when no server claims the job', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
		expect(await resolveJobServer('job1', async () => null)).toBeNull();
	});
});
