import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
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

	// Kodi answers a file from its cache of the directory around it when it has one: after a member
	// browses /repo/ as a source (the install steps say to), a file missing from that listing does
	// not exist to Kodi, and the repository fails "CRepository: failed read …addons.xml.md5" without
	// a request until Kodi restarts (seen on Kodi 21.2, 2026-10-31).
	it('lists every file Kodi reads from /repo/ in the listing Kodi browses', () => {
		const index = readFileSync(path.join(root, 'public/repo/index.html'), 'utf8');
		for (const file of ['addons.xml', 'addons.xml.md5', 'repository.dmm-1.0.0.zip']) {
			expect(index).toContain(`<a href="${file}">${file}</a>`);
		}
	});

	it('ships a repository built from the current sources', () => {
		expect(() => python('scripts/build-kodi-repo.py', '--check')).not.toThrow();
	});
});
