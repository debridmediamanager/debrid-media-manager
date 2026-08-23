import { describe, expect, it } from 'vitest';
import { getPremiumizeStatusText } from './premiumizeStatus';

describe('getPremiumizeStatusText', () => {
	it('maps every documented transfer status', () => {
		expect(getPremiumizeStatusText('queued')).toBe('Queued');
		expect(getPremiumizeStatusText('running')).toBe('Downloading');
		expect(getPremiumizeStatusText('finished')).toBe('Finished');
		expect(getPremiumizeStatusText('seeding')).toBe('Seeding');
		expect(getPremiumizeStatusText('error')).toBe('Error');
	});

	it('names cloud content that has no transfer record left', () => {
		expect(getPremiumizeStatusText('stored')).toBe('In cloud');
	});

	it('passes an unknown status through rather than blanking the cell', () => {
		expect(getPremiumizeStatusText('something_new')).toBe('something_new');
		expect(getPremiumizeStatusText('')).toBe('');
	});
});
