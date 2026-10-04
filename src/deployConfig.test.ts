// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// On 2026-10-04 every dmm_web replica died one by one over seven hours. Each
// missed a single 1s health probe, Swarm sent SIGTERM, Next exited 0, and an
// `on-failure` restart policy treats exit 0 as finished, so no replica came
// back and the site served 502s. These pin the settings that prevent it.

const root = join(__dirname, '..');

function webServiceBlock(): string {
	const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
	const match = compose.match(/^ {2}web:\n((?: {4,}.*\n|\n)*)/m);
	if (!match) throw new Error('docker-compose.yml has no web service');
	return match[1];
}

function seconds(value: string): number {
	const match = value.match(/^(\d+)(s|m)$/);
	if (!match) throw new Error(`unparsed duration ${value}`);
	return Number(match[1]) * (match[2] === 'm' ? 60 : 1);
}

describe('production web service', () => {
	it('restarts replicas that exit cleanly after a health kill', () => {
		expect(webServiceBlock()).toMatch(/restart_policy:\n(?:\s*#.*\n)*\s+condition: any\n/);
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
