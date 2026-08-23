import { describe, expect, it } from 'vitest';
import { isPremiumizeRowId, parsePremiumizeRowId, toPremiumizeRowId } from './premiumizeRow';

describe('premiumize row ids', () => {
	it('round-trips each kind', () => {
		const ids: [Parameters<typeof toPremiumizeRowId>[0], string][] = [
			['transfer', 'C_c5ShzmbWdwiIc-KMP_5A'],
			['folder', 'hp92DFAmxWqvNFC_IzGbWw'],
			['file', 'r9Bo9rCOTW-7oKerVCl0XQ'],
		];
		for (const [kind, id] of ids) {
			const rowId = toPremiumizeRowId(kind, id);
			expect(parsePremiumizeRowId(rowId)).toEqual({ kind, id });
		}
	});

	it('keeps every kind recognisable as a Premiumize row', () => {
		// The rest of the library branches on the three-character service prefix,
		// so a folder row and a transfer row must both answer to it.
		expect(isPremiumizeRowId(toPremiumizeRowId('transfer', 'a'))).toBe(true);
		expect(isPremiumizeRowId(toPremiumizeRowId('folder', 'a'))).toBe(true);
		expect(isPremiumizeRowId(toPremiumizeRowId('file', 'a'))).toBe(true);
		expect(toPremiumizeRowId('folder', 'a').substring(0, 3)).toBe('pm:');
	});

	it('does not claim other services rows', () => {
		expect(isPremiumizeRowId('rd:123')).toBe(false);
		expect(isPremiumizeRowId('tb:w123')).toBe(false);
		expect(parsePremiumizeRowId('ad:123')).toBeNull();
	});

	it('rejects a pm row with no kind character', () => {
		expect(parsePremiumizeRowId('pm:')).toBeNull();
		expect(parsePremiumizeRowId('pm:t')).toBeNull();
		expect(parsePremiumizeRowId('pm:x123')).toBeNull();
	});

	it('preserves ids containing base64url characters', () => {
		// Premiumize ids are 22 characters of base64url and routinely contain
		// - and _; a naive split on a separator would truncate them.
		const id = 'C_c5ShzmbWdwiIc-KMP_5A';
		expect(parsePremiumizeRowId(toPremiumizeRowId('transfer', id))?.id).toBe(id);
	});
});
