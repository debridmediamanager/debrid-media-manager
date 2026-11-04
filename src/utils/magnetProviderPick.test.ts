import { describe, expect, it } from 'vitest';
import { magnetTargets } from './magnetProviderPick';

// Card 359: the RD + Premiumize sign-in the bug was reproduced with.
describe('magnetTargets', () => {
	it('passes a single sign-in straight through, no choice needed', () => {
		expect(magnetTargets(['rd'], null)).toEqual(['rd']);
		expect(magnetTargets(['pm'], null)).toEqual(['pm']);
	});

	it('waits for a choice when several providers are signed in', () => {
		expect(magnetTargets(['rd', 'pm'], null)).toBeNull();
	});

	it('sends only to the chosen provider', () => {
		expect(magnetTargets(['rd', 'pm'], 'pm')).toEqual(['pm']);
	});

	it('ignores a remembered choice that is no longer signed in', () => {
		expect(magnetTargets(['rd', 'pm'], 'tb')).toBeNull();
	});

	it('keeps adding to every provider on All', () => {
		expect(magnetTargets(['rd', 'ad', 'tb', 'pm', 'oc', 'dl'], 'all')).toEqual([
			'rd',
			'ad',
			'tb',
			'pm',
			'oc',
			'dl',
		]);
	});

	it('adds nowhere with no sign-in', () => {
		expect(magnetTargets([], null)).toEqual([]);
	});
});
