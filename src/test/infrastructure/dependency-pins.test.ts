import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => JSON.parse(readFileSync(path.join(process.cwd(), file), 'utf-8'));
const pkg = read('package.json');
const lock = read('package-lock.json');

describe('dependency pins', () => {
	// An unpinned git dependency follows the branch head on every lockfile refresh;
	// f9818bba silently moved ptt to another branch that reads `BS4` as season 4.
	it('pins every git dependency to a commit', () => {
		const git = Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
			([, spec]) => spec.startsWith('github:') || spec.startsWith('git')
		);
		expect(git.length).toBeGreaterThan(0);
		for (const [name, spec] of git) expect(spec, name).toMatch(/#[0-9a-f]{40}$/);
	});

	// Single-maintainer packages with no track record run with the ZeroSSL keys and
	// inside the tracker client: a new release must be a deliberate change.
	it('pins single-maintainer packages to an exact version', () => {
		expect(pkg.dependencies['@geektr/acme-dns01']).toMatch(/^\d+\.\d+\.\d+$/);
		expect(pkg.overrides['bittorrent-tracker'].ip).toMatch(/^npm:@bybrave\/ip2@\d+\.\d+\.\d+$/);
	});

	// npm 12 skips install scripts not in allowScripts, so a version bump without a
	// matching entry ships without the Prisma engine or a native binding.
	it('allows install scripts for the versions actually locked', () => {
		for (const entry of Object.keys(pkg.allowScripts)) {
			const at = entry.lastIndexOf('@');
			const [name, version] = [entry.slice(0, at), entry.slice(at + 1)];
			const locked = Object.entries<{ version?: string }>(lock.packages)
				.filter(([at]) => at.endsWith(`node_modules/${name}`))
				.map(([, meta]) => meta.version);
			expect(locked, entry).toContain(version);
		}
	});
});
