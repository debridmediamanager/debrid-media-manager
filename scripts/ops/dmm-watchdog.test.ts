// @vitest-environment node
import { execFileSync } from 'child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = join(__dirname, 'dmm-watchdog.sh');

let dir: string;

function fake(name: string, body: string) {
	const path = join(dir, 'bin', name);
	writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(path, 0o755);
}

function setup({ healthy, diskPct }: { healthy: boolean; diskPct: number }) {
	fake('curl', healthy ? 'echo \'{"status":"ok"}\'' : 'exit 7');
	fake(
		'df',
		`echo "Filesystem 1024-blocks Used Available Capacity Mounted"; echo "/dev/sda1 100 ${diskPct} 0 ${diskPct}% /"`
	);
}

function run() {
	execFileSync('bash', [script], {
		env: {
			PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
			DMM_WATCHDOG_STATE_DIR: join(dir, 'state'),
			CALLS: join(dir, 'calls'),
			NODE_ENV: 'test',
		},
	});
}

function calls(): string[] {
	try {
		return readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

const redeploys = () => calls().filter((c) => c.startsWith('docker service update'));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dmm-watchdog-'));
	execFileSync('mkdir', ['-p', join(dir, 'bin')]);
	for (const name of ['docker', 'sudo', 'logger']) fake(name, `echo "${name} $*" >> "$CALLS"`);
	fake('flock', 'exit 0');
	setup({ healthy: true, diskPct: 40 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('dmm-watchdog', () => {
	it('leaves a healthy, roomy host alone', () => {
		run();
		run();
		expect(calls()).toEqual([]);
	});

	it('redeploys the web service after three consecutive failed probes', () => {
		setup({ healthy: false, diskPct: 40 });
		run();
		run();
		expect(redeploys()).toEqual([]);
		run();
		expect(redeploys()).toEqual(['docker service update --force --detach dmm_web']);
	});

	it('restarts the failure count when a probe succeeds', () => {
		setup({ healthy: false, diskPct: 40 });
		run();
		run();
		setup({ healthy: true, diskPct: 40 });
		run();
		setup({ healthy: false, diskPct: 40 });
		run();
		run();
		expect(redeploys()).toEqual([]);
	});

	it('does not redeploy again within the cooldown', () => {
		setup({ healthy: false, diskPct: 40 });
		for (let i = 0; i < 9; i++) run();
		expect(redeploys()).toHaveLength(1);
	});

	it('prunes images, build cache and the journal when the disk is nearly full', () => {
		setup({ healthy: true, diskPct: 91 });
		run();
		expect(calls()).toEqual(
			expect.arrayContaining([
				'docker image prune -f',
				'docker builder prune -f --keep-storage 4GB',
				'sudo -n journalctl --vacuum-size=1G',
			])
		);
	});

	it('does not prune below the threshold', () => {
		setup({ healthy: true, diskPct: 84 });
		run();
		expect(calls().filter((c) => !c.startsWith('logger'))).toEqual([]);
	});
});
