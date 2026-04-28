import { describe, expect, test } from 'vitest';
import { getAllDebridStatusText } from './allDebridStatus';

describe('getAllDebridStatusText', () => {
	test('maps status codes to user-friendly text', () => {
		expect(getAllDebridStatusText(0)).toBe('In Queue');
		expect(getAllDebridStatusText(1)).toBe('Downloading');
		expect(getAllDebridStatusText(2)).toBe('Compressing');
		expect(getAllDebridStatusText(3)).toBe('Uploading');
		expect(getAllDebridStatusText(4)).toBe('Ready');
		expect(getAllDebridStatusText(5)).toBe('Upload Failed');
		expect(getAllDebridStatusText(6)).toBe('Unpacking Error');
		expect(getAllDebridStatusText(7)).toBe('No Peer (20min timeout)');
		expect(getAllDebridStatusText(8)).toBe('File Too Big');
		expect(getAllDebridStatusText(9)).toBe('Internal Error');
		expect(getAllDebridStatusText(10)).toBe('Download Timeout (72h)');
		expect(getAllDebridStatusText(11)).toBe('Expired - Files Removed');
		expect(getAllDebridStatusText(12)).toBe('Processing Failed');
		expect(getAllDebridStatusText(13)).toBe('Processing Failed');
		expect(getAllDebridStatusText(14)).toBe('Tracker Error');
		expect(getAllDebridStatusText(15)).toBe('No Peer Available');
	});

	test('handles string input', () => {
		expect(getAllDebridStatusText('7')).toBe('No Peer (20min timeout)');
		expect(getAllDebridStatusText('11')).toBe('Expired - Files Removed');
	});

	test('handles unknown status codes', () => {
		expect(getAllDebridStatusText(999)).toBe('Unknown Status (999)');
		expect(getAllDebridStatusText(-1)).toBe('Unknown Status (-1)');
	});
});
