// @vitest-environment node
import { execFileSync } from 'child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gunzipSync, gzipSync } from 'zlib';

const script = join(__dirname, 'maintain.sh');
const DAY = 86_400_000;

let dir: string;

const day = (offsetDays: number) =>
	new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

function file(name: string, body: string | Buffer, ageMinutes = 0) {
	const path = join(dir, name);
	writeFileSync(path, body);
	const when = new Date(Date.now() - ageMinutes * 60_000);
	utimesSync(path, when, when);
	return path;
}

const run = () =>
	execFileSync('sh', [script], {
		env: { PATH: process.env.PATH, LOGSHIP_DIR: dir, NODE_ENV: 'test' },
	});
const gz = (name: string) => gunzipSync(readFileSync(join(dir, name))).toString();

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'logship-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('logship maintain.sh', () => {
	it('compresses a day Vector stopped writing an hour ago', () => {
		const name = `web-${day(-1)}.log`;
		file(name, 'line 1\nline 2\n', 61);
		run();
		expect(existsSync(join(dir, name))).toBe(false);
		expect(gz(`${name}.gz`)).toBe('line 1\nline 2\n');
		expect(statSync(join(dir, `${name}.gz`)).mode & 0o077).toBe(0);
	});

	it('leaves the file Vector is still writing alone', () => {
		const name = `web-${day(0)}.log`;
		file(name, 'still going\n', 5);
		run();
		expect(readdirSync(dir)).toEqual([name]);
	});

	it('merges lines that arrive after a day was compressed', () => {
		const name = `web-${day(-2)}.log`;
		file(`${name}.gz`, gzipSync('early\n'), 600);
		file(name, 'late\n', 90);
		run();
		expect(readdirSync(dir)).toEqual([`${name}.gz`]);
		expect(gz(`${name}.gz`)).toBe('early\nlate\n');
	});

	it('keeps an unreadable archive rather than replacing it with a partial merge', () => {
		const name = `web-${day(-2)}.log`;
		file(`${name}.gz`, 'not gzip', 600);
		file(name, 'late\n', 90);
		run();
		expect(readFileSync(join(dir, `${name}.gz`), 'utf8')).toBe('not gzip');
		expect(readFileSync(join(dir, name), 'utf8')).toBe('late\n');
		expect(readdirSync(dir).sort()).toEqual([name, `${name}.gz`].sort());
	});

	it('deletes days older than fourteen by the date in the name', () => {
		for (const offset of [-30, -15, -14, -13, 0]) {
			file(`web-${day(offset)}.log.gz`, gzipSync('x\n'));
		}
		file('unrelated.txt', 'keep\n', 60 * 24 * 30);
		run();
		expect(readdirSync(dir).sort()).toEqual(
			[
				`web-${day(-14)}.log.gz`,
				`web-${day(-13)}.log.gz`,
				`web-${day(0)}.log.gz`,
				'unrelated.txt',
			].sort()
		);
	});
});
