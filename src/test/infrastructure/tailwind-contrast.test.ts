import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import postcss, { type AnyNode, type PluginCreator, type Root } from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

import { episodeChipClasses, getColorScale } from '@/utils/episodeUtils';

// Every class list that paints its own solid background and text colour must
// meet WCAG AA. Buttons are the common case: `bg-blue-500 text-white` reads at
// 3.7:1 and `bg-green-500 text-white` at 2.3:1, below the 4.5:1 body-text floor.
// Text on an inherited background cannot be judged from one class list; the
// browser matrix in scripts/responsive_matrix.py measures that.

const SRC = path.join(process.cwd(), 'src');

// The app's node module resolution cannot consume this package's ESM-only
// declarations; load its public CJS entry with the PostCSS plugin contract.
const tailwind = createRequire(path.join(process.cwd(), 'package.json'))(
	'@tailwindcss/postcss'
) as PluginCreator<{ optimize: boolean; base: string }>;

type Rgb = [number, number, number];

const palette = new Map<string, string>();
let stylesheet: Root;

beforeAll(async () => {
	const from = path.join(SRC, 'styles/globals.css');
	const fixture = `
		@source inline("shadow shadow-sm rounded rounded-sm blur blur-sm ring bg-black/50 hover:bg-black/75 animate-slide-up shadow-glow shadow-music-lg shadow-music-2xl");
	`;
	const result = await postcss([tailwind({ optimize: false, base: SRC })]).process(
		readFileSync(from, 'utf-8') + fixture,
		{ from }
	);
	stylesheet = result.root;
	stylesheet.walkDecls(/^--color-/, ({ prop, value }) => {
		palette.set(prop.slice('--color-'.length), value);
	});
	// Scanning all of src takes ~7 s idle and over 60 s on a loaded machine.
}, 120_000);

const colour = (token: string): Rgb | null => {
	if (token === 'white') return [255, 255, 255];
	if (token === 'black') return [0, 0, 0];
	const match = token.match(/^([a-z]+)-(\d{2,3})$/);
	if (!match) return null;
	const value = palette.get(token);
	// An unresolved/new color format must fail, not silently stop checking AA.
	if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
		throw new Error(`Cannot measure the compiled application color: ${token} (${value})`);
	}
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

describe('compiled application styling', () => {
	const declarations = (selector: string, property: string) => {
		const values: string[] = [];
		stylesheet.walkRules((rule) => {
			if (rule.selector !== selector) return;
			rule.walkDecls(property, ({ value }) => {
				values.push(value);
			});
		});
		return values;
	};

	const themeValue = (property: string) => {
		const values: string[] = [];
		stylesheet.walkDecls(property, ({ value }) => {
			values.push(value);
		});
		return values.at(-1);
	};

	it('uses the application palette for emitted foreground and background utilities', () => {
		expect(colour('blue-600')).toEqual([37, 99, 235]);
		expect(colour('gray-900')).toEqual([17, 24, 39]);
		expect(declarations('.bg-blue-600', 'background-color')).toContain('var(--color-blue-600)');
		expect(declarations('.text-gray-100', 'color')).toContain('var(--color-gray-100)');
		expect(() => colour('unknown-500')).toThrow('Cannot measure');
	});

	it('retains distinct small and bare radii, shadows, blurs and focus rings', () => {
		expect(themeValue('--radius')).toBe('0.25rem');
		expect(themeValue('--radius-sm')).toBe('0.125rem');
		expect(declarations('.rounded', 'border-radius')).toContain('var(--radius)');
		expect(declarations('.rounded-sm', 'border-radius')).toContain('var(--radius-sm)');
		expect(themeValue('--shadow')).toContain('0 1px 3px');
		expect(themeValue('--shadow-sm')).toBe('0 1px 2px 0 rgb(0 0 0 / 0.05)');
		expect(themeValue('--blur')).toBe('8px');
		expect(themeValue('--blur-sm')).toBe('4px');
		expect(declarations('.ring', '--tw-ring-shadow').join(' ')).toContain('3px');
	});

	it('emits translucent overlays and unrestricted hover states', () => {
		expect(declarations('.bg-black\\/50', 'background-color').join(' ')).toMatch(/50%/);
		const hoverRules: string[] = [];
		stylesheet.walkRules((rule) => {
			if (!rule.selector.includes('hover\\:bg-black\\/75')) return;
			hoverRules.push(rule.toString());
			let ancestor: AnyNode | undefined = rule.parent;
			while (ancestor) {
				if (ancestor.type === 'atrule' && ancestor.name === 'media') {
					expect(ancestor.params).not.toContain('hover: hover');
				}
				ancestor = ancestor.parent;
			}
		});
		expect(hoverRules.join(' ')).toContain(':hover');
		expect(hoverRules.join(' ')).toMatch(/75%/);
	});

	it('emits the music animation and custom shadows', () => {
		expect(themeValue('--animate-slide-up')).toContain('slide-up 400ms');
		expect(declarations('.animate-slide-up', 'animation')).toContain('var(--animate-slide-up)');
		expect(themeValue('--shadow-glow')).toBe('0 0 10px blue, 0 0 15px blue');
		expect(declarations('.shadow-music-lg', '--tw-shadow').join(' ')).toContain('25px');
		expect(declarations('.shadow-music-2xl', '--tw-shadow').join(' ')).toContain('50px');
	});

	// The episode legends once built `bg-${scale.color}`. Tailwind 4 emits only
	// classes written out in the source, so the Incomplete chip shipped with no
	// background on 8f1225f7.
	it('emits a background for every episode legend chip', () => {
		for (const { color } of getColorScale(10)) {
			const className = episodeChipClasses[color];
			expect(className, color).toBeDefined();
			expect(declarations(`.${className}`, 'background-color'), className).not.toEqual([]);
		}
	});
});
