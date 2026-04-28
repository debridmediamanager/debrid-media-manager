import { describe, expect, test } from 'vitest';
import { getTorBoxStatusText } from './torBoxStatus';

describe('getTorBoxStatusText', () => {
	test('maps processing statuses to user-friendly text', () => {
		expect(getTorBoxStatusText('queued')).toBe('Queued');
		expect(getTorBoxStatusText('checking')).toBe('Checking');
		expect(getTorBoxStatusText('downloading')).toBe('Downloading');
		expect(getTorBoxStatusText('uploading')).toBe('Seeding'); // TorBox uses "uploading" for seeding
	});

	test('maps success statuses to user-friendly text', () => {
		expect(getTorBoxStatusText('finished')).toBe('Finished');
		expect(getTorBoxStatusText('seeding')).toBe('Seeding');
	});

	test('maps error status to user-friendly text', () => {
		expect(getTorBoxStatusText('error')).toBe('Error');
	});

	test('handles case insensitive input', () => {
		expect(getTorBoxStatusText('QUEUED')).toBe('Queued');
		expect(getTorBoxStatusText('Downloading')).toBe('Downloading');
		expect(getTorBoxStatusText('UPLOADING')).toBe('Seeding');
		expect(getTorBoxStatusText('FINISHED')).toBe('Finished');
	});

	test('handles unknown status by returning raw status', () => {
		expect(getTorBoxStatusText('unknown_status')).toBe('unknown_status');
		expect(getTorBoxStatusText('')).toBe('');
	});
});
