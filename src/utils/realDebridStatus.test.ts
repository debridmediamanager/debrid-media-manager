import { describe, expect, test } from 'vitest';
import { getRealDebridStatusText } from './realDebridStatus';

describe('getRealDebridStatusText', () => {
	test('maps processing statuses to user-friendly text', () => {
		expect(getRealDebridStatusText('magnet_conversion')).toBe('Converting Magnet');
		expect(getRealDebridStatusText('waiting_files_selection')).toBe('Waiting File Selection');
		expect(getRealDebridStatusText('queued')).toBe('Queued');
		expect(getRealDebridStatusText('downloading')).toBe('Downloading');
		expect(getRealDebridStatusText('compressing')).toBe('Compressing');
		expect(getRealDebridStatusText('uploading')).toBe('Uploading');
	});

	test('maps success status to user-friendly text', () => {
		expect(getRealDebridStatusText('downloaded')).toBe('Downloaded');
	});

	test('maps error statuses to user-friendly text', () => {
		expect(getRealDebridStatusText('magnet_error')).toBe('Magnet Error');
		expect(getRealDebridStatusText('error')).toBe('Error');
		expect(getRealDebridStatusText('virus')).toBe('Virus Detected');
		expect(getRealDebridStatusText('dead')).toBe('Dead Torrent');
	});

	test('handles unknown status by returning raw status', () => {
		expect(getRealDebridStatusText('unknown_status')).toBe('unknown_status');
		expect(getRealDebridStatusText('')).toBe('');
	});
});
