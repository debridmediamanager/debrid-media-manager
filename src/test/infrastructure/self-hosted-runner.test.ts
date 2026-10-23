import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// dmm-01, the production host, runs jobs for this public repository. GitHub only
// hands it to build-and-push.yml on refs/heads/main (org runner group
// dmm-prod-deploy, 2026-10-23); before that a probe workflow pushed from a branch
// ran on it. These checks keep the workflows in line with that restriction.
const dir = path.join(process.cwd(), '.github/workflows');
const workflows = readdirSync(dir)
	.filter((f) => /\.ya?ml$/.test(f))
	.map((f) => ({ file: f, text: readFileSync(path.join(dir, f), 'utf-8') }));

// A job is the block from its two-space-deeper key under `jobs:` to the next.
const jobsOf = (text: string) =>
	text
		.slice(text.indexOf('\njobs:'))
		.split(/\n(?=    [a-z0-9_-]+:\n)/i)
		.slice(1);

describe('self-hosted runner use', () => {
	const selfHosted = workflows.flatMap(({ file, text }) =>
		jobsOf(text)
			.filter((job) => /runs-on:.*self-hosted/.test(job))
			.map((job) => ({ file, job }))
	);

	it('is confined to the deploy workflow', () => {
		expect(selfHosted.length).toBeGreaterThan(0);
		expect([...new Set(selfHosted.map((j) => j.file))]).toEqual(['build-and-push.yml']);
	});

	it('runs only for pushes, and asks for the production runner by label', () => {
		for (const { job } of selfHosted) {
			expect(job).toMatch(/\n        if: github\.event_name == 'push'\n/);
			expect(job).toMatch(/runs-on: \[self-hosted, prod\]/);
		}
	});

	it('is triggered by pushes to main alone', () => {
		const deploy = workflows.find((w) => w.file === 'build-and-push.yml')!.text;
		const push = deploy.slice(deploy.indexOf('    push:'), deploy.indexOf('    pull_request:'));
		expect(push).toMatch(/branches:\n\s+- main\n/);
		expect(push).not.toMatch(/branches:\n\s+- main\n\s+- /);
	});
});
