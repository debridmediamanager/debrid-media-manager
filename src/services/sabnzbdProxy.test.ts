import {
	needsUsernameSlot,
	SAB_PREFIX,
	sabError,
	sabMode,
	sabTargetPath,
	sabUrlBase,
} from '@/services/sabnzbdProxy';
import { describe, expect, it } from 'vitest';

describe('sabTargetPath', () => {
	it('strips the DMM prefix and keeps the mount root and query', () => {
		expect(
			sabTargetPath(`${SAB_PREFIX}/mnt/zurg/__all__/api?mode=queue&apikey=RDKEY&limit=60`)
		).toBe('/mnt/zurg/__all__/api?mode=queue&apikey=RDKEY&limit=60');
	});

	it('handles a bare /api, the no-mount-root case', () => {
		expect(sabTargetPath(`${SAB_PREFIX}/api?mode=version`)).toBe('/api?mode=version');
	});

	it('tolerates a trailing slash', () => {
		expect(sabTargetPath(`${SAB_PREFIX}/api/?mode=version`)).toBe('/api/?mode=version');
	});

	it('keeps a percent-encoded mount root encoded', () => {
		expect(sabTargetPath(`${SAB_PREFIX}/mnt/my%20mount/api?mode=history`)).toBe(
			'/mnt/my%20mount/api?mode=history'
		);
	});

	// The guard that makes this proxy safe to expose: nzb2rd serves an
	// unauthenticated management API on every path that is not `/api`.
	it.each([
		['the job list', `${SAB_PREFIX}/jobs`],
		['a single job', `${SAB_PREFIX}/jobs/abc-123`],
		['the health endpoint', `${SAB_PREFIX}/health`],
		['the dashboard', `${SAB_PREFIX}/`],
		['the prefix itself', SAB_PREFIX],
		['a path that merely contains api', `${SAB_PREFIX}/api/jobs`],
	])('refuses %s', (_label, url) => {
		expect(sabTargetPath(url)).toBeNull();
	});

	it('refuses a traversal that would climb out of the /api check', () => {
		expect(sabTargetPath(`${SAB_PREFIX}/x/../../jobs/api`)).toBeNull();
	});

	it('refuses the webseed path, which a release file could be named into', () => {
		expect(sabTargetPath(`${SAB_PREFIX}/webseed/job-1/dir/api`)).toBeNull();
	});

	it('refuses a URL outside the prefix', () => {
		expect(sabTargetPath('/api/nzb2rd/jobs/api')).toBeNull();
		expect(sabTargetPath('/api/sabnzbdextra/api')).toBeNull();
		expect(sabTargetPath(undefined)).toBeNull();
	});
});

describe('sabMode', () => {
	it('reads the mode', () => {
		expect(sabMode(`${SAB_PREFIX}/api?mode=get_config&apikey=RDKEY`)).toBe('get_config');
	});

	it('never returns caller-controlled junk that could forge a log line', () => {
		expect(sabMode(`${SAB_PREFIX}/api?mode=queue%0a%5bsab%5d+owner`)).toBe('-');
		expect(sabMode(`${SAB_PREFIX}/api?apikey=RDKEY`)).toBe('-');
		expect(sabMode(undefined)).toBe('-');
	});
});

describe('sabError', () => {
	it('uses SABnzbd’s envelope, which *arr shows verbatim', () => {
		expect(sabError('nzb2rd is unreachable')).toEqual({
			status: false,
			error: 'nzb2rd is unreachable',
		});
	});
});

describe('sabUrlBase', () => {
	it('puts the mount root in the URL Base', () => {
		expect(sabUrlBase('/mnt/zurg/__all__')).toBe('api/sabnzbd/mnt/zurg/__all__');
		expect(sabUrlBase('mnt/zurg/__all__')).toBe('api/sabnzbd/mnt/zurg/__all__');
		expect(sabUrlBase('/data/media/')).toBe('api/sabnzbd/data/media');
	});

	it('falls back to the bare prefix when there is no mount root', () => {
		expect(sabUrlBase('')).toBe('api/sabnzbd');
		expect(sabUrlBase('   ')).toBe('api/sabnzbd');
		expect(sabUrlBase('/')).toBe('api/sabnzbd');
	});

	// nzb2rd reads this form off the raw path and never decodes it, so a root
	// that needs encoding would produce a wrong import path rather than fail.
	it('keeps a root that cannot survive a URL out of the URL Base', () => {
		expect(sabUrlBase('D:\\zurg')).toBe('api/sabnzbd');
		expect(sabUrlBase('/mnt/my mount')).toBe('api/sabnzbd');
	});
});

describe('needsUsernameSlot', () => {
	it.each([['D:\\zurg'], ['C:/media'], ['\\\\nas\\share'], ['/mnt/my mount'], ['/mnt/100%']])(
		'sends %s via ma_username',
		(value) => {
			expect(needsUsernameSlot(value)).toBe(true);
		}
	);

	it.each([['/mnt/zurg/__all__'], ['/data/media'], ['']])('leaves %s in the path', (value) => {
		expect(needsUsernameSlot(value)).toBe(false);
	});
});
