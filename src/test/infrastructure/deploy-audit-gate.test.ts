import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
	path.join(process.cwd(), '.github/workflows/build-and-push.yml'),
	'utf-8'
);

// Deploy needs the audit job, and a revert-and-push is the rollback. f9818bba made
// any low advisory in any dev tool stop every deploy, the revert included.
describe('deploy audit gate', () => {
	const steps = workflow.split('\n            - ').filter((step) => step.includes('npm audit'));

	it('blocks a push only on high advisories in runtime dependencies', () => {
		const blocking = steps.filter(
			(step) => !/continue-on-error: \$\{\{ github\.event_name == 'push' \}\}/.test(step)
		);
		expect(blocking.length).toBeGreaterThan(0);
		for (const step of blocking) {
			expect(step).toContain('--omit=dev');
			expect(step).toMatch(/--audit-level=(high|critical)/);
		}
	});

	it('still reports every advisory', () => {
		expect(
			steps.some((step) => step.includes('--audit-level=low') && !step.includes('--omit=dev'))
		).toBe(true);
	});
});
