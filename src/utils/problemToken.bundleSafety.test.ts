import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

// The bug this guards against, restated: the availability token used to be signed
// in the browser from a constant in `utils/token.ts`. Because the movie, show and
// hashlist pages import that module, the constant shipped in the bundle — so the
// signing key was public and every endpoint it protected was open.
//
// Signing moved server-side, but nothing structurally stops someone importing the
// server module from a component and putting the new secret straight back into the
// bundle. These tests are that stop.

const repoRoot = path.resolve(__dirname, '../..');

function grep(pattern: string, paths: string[]): string[] {
	try {
		const out = execFileSync('grep', ['-rlE', pattern, ...paths], {
			cwd: repoRoot,
			encoding: 'utf-8',
		});
		return out.split('\n').filter(Boolean);
	} catch {
		// grep exits 1 when nothing matches.
		return [];
	}
}

const CLIENT_DIRS = ['src/components', 'src/hooks'];

describe('the signing key stays out of the client bundle', () => {
	it('is not referenced anywhere outside the server-only modules', () => {
		const offenders = grep('DMM_PROBLEM_SECRET', ['src'])
			.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
			.filter(
				(f) =>
					f !== 'src/utils/problemToken.ts' &&
					f !== 'src/pages/api/challenge.ts'
			);

		expect(offenders).toEqual([]);
	});

	it('is not reachable from a component or hook', () => {
		const offenders = grep(
			"from '@/utils/(problemToken|legacyProblemToken)'",
			CLIENT_DIRS
		).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

		expect(offenders).toEqual([]);
	});

	it('is not reachable from a page outside an API route', () => {
		const offenders = grep(
			"from '@/utils/(problemToken|legacyProblemToken)'",
			['src/pages']
		)
			.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
			.filter((f) => !f.startsWith('src/pages/api/'));

		expect(offenders).toEqual([]);
	});

	it('no longer lives as a constant in the client token module', () => {
		const offenders = grep('debridmediamanager\\.com%%', ['src/utils/token.ts']);

		expect(offenders).toEqual([]);
	});
});
