import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import colors from 'tailwindcss/colors';
import { describe, expect, it } from 'vitest';

// Every class list that paints its own solid background and text colour must
// meet WCAG AA. Buttons are the common case: `bg-blue-500 text-white` reads at
// 3.7:1 and `bg-green-500 text-white` at 2.3:1, below the 4.5:1 body-text floor.
// Text on an inherited background cannot be judged from one class list; the
// browser matrix in scripts/responsive_matrix.py measures that.

const SRC = path.join(process.cwd(), 'src');

type Rgb = [number, number, number];

const palette = colors as unknown as Record<string, Record<string, string> | string>;

const colour = (token: string): Rgb | null => {
	if (token === 'white') return [255, 255, 255];
	if (token === 'black') return [0, 0, 0];
	const match = token.match(/^([a-z]+)-(\d{2,3})$/);
	if (!match) return null;
	const shades = palette[match[1]];
	const value = typeof shades === 'object' ? shades[match[2]] : undefined;
	if (!value || !value.startsWith('#')) return null;
	return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
};

const luminance = (rgb: Rgb) =>
	rgb
		.map((v) => v / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
		.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

const contrastRatio = (a: Rgb, b: Rgb) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(full);
		return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
	});

// Only unprefixed tokens are the resting state; hover:/disabled: variants are
// transient and an opacity modifier (bg-green-900/30) blends with the page.
const solid = (tokens: string[], prefix: 'bg' | 'text') =>
	tokens
		.filter((t) => new RegExp(`^${prefix}-(?:[a-z]+-\\d{2,3}|white|black)$`).test(t))
		.map((t) => t.slice(prefix.length + 1));

const classListViolations = (source: string) => {
	const violations: { classes: string; ratio: number }[] = [];
	for (const match of source.matchAll(/className=\{?(["'`])([^"'`]+)\1/g)) {
		// A checkbox's text colour is its tick accent, not text.
		const tagStart = source.lastIndexOf('<', match.index);
		if (source.slice(tagStart, tagStart + 6) === '<input') continue;
		const classes = match[2];
		const tokens = classes.split(/\s+/);
		const [bg] = solid(tokens, 'bg');
		const [fg] = solid(tokens, 'text');
		if (solid(tokens, 'bg').length !== 1 || solid(tokens, 'text').length !== 1) continue;
		const background = colour(bg);
		const foreground = colour(fg);
		if (!background || !foreground) continue;
		const ratio = contrastRatio(background, foreground);
		const large =
			/(^|\s)text-[2-9]xl(\s|$)/.test(classes) ||
			(/(^|\s)text-(lg|xl)(\s|$)/.test(classes) && /(^|\s)font-bold(\s|$)/.test(classes));
		if (ratio < (large ? 3 : 4.5)) violations.push({ classes, ratio });
	}
	return violations;
};

describe('solid colour class lists', () => {
	it('flags the shapes this guards against', () => {
		expect(
			classListViolations('<button className="rounded bg-blue-500 px-4 text-white">')
		).toHaveLength(1);
		expect(
			classListViolations('<button className="rounded bg-blue-600 px-4 text-white">')
		).toEqual([]);
		expect(
			classListViolations('<input className="h-4 w-4 bg-gray-600 text-purple-600" />')
		).toEqual([]);
	});

	it('meet WCAG AA contrast everywhere in src', () => {
		const offenders = sourceFiles(SRC).flatMap((file) =>
			classListViolations(readFileSync(file, 'utf-8')).map(
				({ classes, ratio }) =>
					`${path.relative(SRC, file)}: ${ratio.toFixed(2)}:1 "${classes}"`
			)
		);
		expect(offenders).toEqual([]);
	});
});
