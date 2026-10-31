import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

// The Kodi addon is Python (kodi/), and what Kodi users install is the zip in public/repo/,
// so the suite runs the addon's own tests and fails when that zip no longer matches its sources.
const root = path.resolve(__dirname, '../../..');
const python = (...args: string[]) =>
	execFileSync('python3', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });

describe('Kodi addon', () => {
	it('passes its own tests', () => {
		expect(() =>
			python('-m', 'unittest', 'discover', '-s', 'kodi/plugin.video.dmm/tests')
		).not.toThrow();
	});

	it('ships a repository built from the current sources', () => {
		expect(() => python('scripts/build-kodi-repo.py', '--check')).not.toThrow();
	});
});
