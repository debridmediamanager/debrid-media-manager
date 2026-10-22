// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The Stremio pages legitimately return a different next/head in each branch.
// Duplicate next/document heads, in contrast, make an invalid custom document.
const page = `import Head from 'next/head';
export default function Page({ connected }) {
  if (!connected) return <div><Head><title>Connect</title></Head></div>;
  return <div><Head><title>Connected</title></Head></div>;
}`;
const document = (count) => `import { Head, Html } from 'next/document';
export default function Document() {
  return <Html>${'<Head />'.repeat(count)}</Html>;
}`;

function lint(filename, source) {
	const root = mkdtempSync(path.join(tmpdir(), 'dmm-next-head-'));
	try {
		const file = path.join(root, 'src/pages', filename);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		let output;
		try {
			output = execFileSync(
				path.join(process.cwd(), 'node_modules/.bin/oxlint'),
				[
					'--config',
					path.join(process.cwd(), '.oxlintrc.json'),
					'--format',
					'json',
					'--threads',
					'1',
					file,
				],
				{ cwd: root, encoding: 'utf8' }
			);
		} catch (error) {
			if (error.status !== 1 || !error.stdout) throw error;
			output = error.stdout;
		}
		return JSON.parse(output).diagnostics;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe('Next Head lint consumer behavior', () => {
	it('accepts mutually exclusive page heads without confusing them with document heads', () => {
		expect(lint('stremio/index.tsx', page)).toEqual([]);
	});
	it('accepts a single custom document head', () => {
		expect(lint('_document.tsx', document(1))).toEqual([]);
	});
	it('rejects duplicate custom document heads', () => {
		const diagnostics = lint('_document.tsx', document(2));
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].code).toMatch(/no-duplicate-head/);
		expect(diagnostics[0].severity).toBe('error');
	});
});
