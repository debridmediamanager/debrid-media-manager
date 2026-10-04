// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// On 2026-10-04 every dmm_web replica died one by one over seven hours. Each
// missed a single 1s health probe, Swarm sent SIGTERM, Next exited 0, and an
// `on-failure` restart policy treats exit 0 as finished, so no replica came
// back and the site served 502s. These pin the settings that prevent it.

const root = join(__dirname, '..');

function serviceBlock(name: string): string {
	const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
	const match = compose.match(new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\n)*)`, 'm'));
	if (!match) throw new Error(`docker-compose.yml has no ${name} service`);
	return match[1];
}

const webServiceBlock = () => serviceBlock('web');

function seconds(value: string): number {
	const match = value.match(/^(\d+)(s|m)$/);
	if (!match) throw new Error(`unparsed duration ${value}`);
	return Number(match[1]) * (match[2] === 'm' ? 60 : 1);
}

describe('production web service', () => {
	it('restarts replicas that exit cleanly after a health kill', () => {
		expect(webServiceBlock()).toMatch(/restart_policy:\n(?:\s*#.*\n)*\s+condition: any\n/);
	});

	it.each(['web', 'redis'])('restarts %s after any exit, clean or not', (name) => {
		const restart = serviceBlock(name).match(
			/restart_policy:\n(?:\s*#.*\n)*\s+condition: (\S+)/
		);
		expect(restart?.[1] ?? 'any').toBe('any');
	});

	it('tolerates a single slow health probe', () => {
		const web = webServiceBlock();
		const retries = Number(web.match(/^\s+retries: (\d+)$/m)?.[1] ?? 0);
		const timeout = web.match(/^\s+timeout: (\S+)$/m)?.[1];
		expect(retries).toBeGreaterThanOrEqual(3);
		expect(timeout && seconds(timeout)).toBeGreaterThanOrEqual(5);
	});

	it('keeps the image default healthcheck equally tolerant', () => {
		const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
		const healthcheck = dockerfile.match(/^HEALTHCHECK (.*)$/m)?.[1] ?? '';
		const retries = Number(healthcheck.match(/--retries=(\d+)/)?.[1] ?? 0);
		const timeout = healthcheck.match(/--timeout=(\S+)/)?.[1] ?? '0s';
		expect(retries).toBeGreaterThanOrEqual(3);
		expect(seconds(timeout)).toBeGreaterThanOrEqual(5);
	});
});

// The same day dmm-01's disk reached 98%: each deploy leaves the previous
// 1.17GB dmm-prod image untagged, and the cleanup step only removed images
// and build cache older than 24 hours, so a busy deploy day kept ~20 old
// builds plus ~24GB of cache.
describe('deploy workflow cleanup', () => {
	const workflow = readFileSync(join(root, '.github/workflows/build-and-push.yml'), 'utf8');
	const cleanup = workflow.match(/- name: Cleanup Docker\n((?: {8,}.*\n?)*)/)?.[1] ?? '';

	it('runs even when an earlier step fails', () => {
		expect(cleanup).toMatch(/^\s+if: always\(\)$/m);
	});

	it('removes every superseded untagged image regardless of age', () => {
		expect(cleanup).toMatch(/^\s+docker image prune -f$/m);
	});

	it('caps the build cache by size rather than age alone', () => {
		expect(cleanup).toMatch(/docker builder prune -f --keep-storage \d+GB/);
	});
});

describe('deploy workflow watchdog', () => {
	const workflow = readFileSync(join(root, '.github/workflows/build-and-push.yml'), 'utf8');

	it('installs the watchdog script and its every-minute cron entry', () => {
		expect(workflow).toContain(
			'install -m 755 scripts/ops/dmm-watchdog.sh /home/ben/dmm/dmm-watchdog.sh'
		);
		expect(workflow).toContain('* * * * * /home/ben/dmm/dmm-watchdog.sh');
	});
});
