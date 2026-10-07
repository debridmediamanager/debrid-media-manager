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

	it.each(['web', 'redis', 'logship'])('restarts %s after any exit, clean or not', (name) => {
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

// Swarm deletes a container's log with its task and keeps five tasks per
// replica, so on 2026-10-03, with 27 deploys, dmm_web's logs reached back about
// four hours. logship copies them, credentials redacted, into one gzip file per
// day on the host. Its Vector unit tests (scripts/ops/logship/vector.test.yaml)
// cover the filtering and redaction and gate the deploy.
describe('dmm_web log retention', () => {
	const logship = () => serviceBlock('logship');
	const vector = () => readFileSync(join(root, 'scripts/ops/logship/vector.yaml'), 'utf8');
	const workflow = readFileSync(join(root, '.github/workflows/build-and-push.yml'), 'utf8');
	const step = (name: string) => workflow.indexOf(`- name: ${name}\n`);
	const section = (name: string) => {
		const config = vector();
		const start = config.indexOf(`\n${name}:\n`);
		const next = config.slice(start + 1).search(/\n\S/);
		return next < 0 ? config.slice(start) : config.slice(start, start + 1 + next);
	};

	it('runs a pinned Vector, never a moving tag', () => {
		expect(logship()).toMatch(/^\s+image: timberio\/vector:\d+\.\d+\.\d+-alpine$/m);
	});

	// The docker_logs source skips a line stamped earlier than the one before
	// it, and stdout and stderr interleave out of order: in a test swarm it
	// lost 8% of the lines of a container writing both. The files lose none.
	it("reads Docker's json-file logs read-only instead of the Docker API", () => {
		expect(logship()).toContain('- /var/lib/docker/containers:/var/lib/docker/containers:ro');
		expect(logship()).not.toContain('docker.sock');
		expect(section('sources')).toMatch(/type: file\n/);
		expect(section('sources')).not.toMatch(/type: docker_logs/);
		expect(section('sources')).toContain(
			"include: ['/var/lib/docker/containers/*/*-json.log']"
		);
	});

	it('labels every web log entry with its Swarm task', () => {
		expect(webServiceBlock()).toMatch(
			/logging:\n\s+driver: json-file\n\s+options:\n\s+max-size: '\d+m'\n\s+max-file: '\d+'\n\s+labels: 'com\.docker\.swarm\.task\.name'\n/
		);
	});

	it('keeps read positions across restarts, advancing them only past written lines', () => {
		expect(vector()).toMatch(/^data_dir: \/var\/lib\/vector$/m);
		expect(section('sinks')).toMatch(/acknowledgements:\n\s+enabled: true\n/);
		expect(logship()).toContain('- logship_state:/var/lib/vector');
	});

	it('restarts after any exit and runs on every node', () => {
		expect(logship()).toMatch(/restart_policy:\n\s+condition: any\n/);
		expect(logship()).toMatch(/^\s+mode: global$/m);
		expect(logship()).toMatch(/^\s+memory: \d+M$/m);
	});

	it('loads the installed config and reloads it when CI replaces it', () => {
		expect(logship()).toContain('- /home/ben/dmm/logship:/etc/vector:ro');
		expect(logship()).toMatch(
			/exec vector --config \/etc\/vector\/vector\.yaml --watch-config/
		);
	});

	it('writes owner-only files and runs the hourly compression and retention', () => {
		expect(logship()).toContain('- /var/log/dmm-web:/var/log/dmm-web');
		expect(logship()).toMatch(/umask 077;/);
		expect(logship()).toContain(
			'while true; do sh /etc/vector/maintain.sh; sleep 3600; done &'
		);
	});

	it('writes only web lines that went through the redaction', () => {
		const transforms = section('transforms');
		expect(transforms).toContain(
			'contains(to_string(.message) ?? "", "\\"com.docker.swarm.task.name\\":\\"dmm_web.")'
		);
		expect(transforms).toMatch(/redact:\n\s+type: remap\n\s+inputs: \[web\]\n/);
		expect(transforms).toMatch(/^\s+drop_on_error: true$/m);
		expect(transforms).toMatch(/^\s+drop_on_abort: true$/m);
		const sinks = section('sinks');
		expect(sinks.match(/inputs: \[[^\]]*\]/g)).toEqual(['inputs: [redact]']);
		expect(sinks).toContain('path: /var/log/dmm-web/web-%Y-%m-%d.log\n');
		// A killed Vector leaves an unfinished gzip member that hides every
		// later line of the day from zcat; maintain.sh compresses instead.
		expect(sinks).not.toContain('compression:');
	});

	it('tests the config and creates the bind sources before the stack deploys', () => {
		const install = workflow.slice(
			step('Install log shipping'),
			step('Deploy to Docker Swarm')
		);
		expect(step('Install log shipping')).toBeGreaterThan(-1);
		expect(step('Install log shipping')).toBeLessThan(step('Deploy to Docker Swarm'));
		expect(install).toContain(
			"image=$(grep -o -m1 'timberio/vector:[^ ]*' docker-compose.yml)"
		);
		expect(install).toContain('test /etc/vector/vector.yaml /etc/vector/vector.test.yaml');
		expect(install).toContain('sudo -n install -d -m 700 /var/log/dmm-web');
		expect(install).toContain(
			'cp scripts/ops/logship/vector.yaml scripts/ops/logship/maintain.sh /home/ben/dmm/logship/'
		);
	});
});
