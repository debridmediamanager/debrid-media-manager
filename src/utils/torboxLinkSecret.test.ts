import { describe, expect, it } from 'vitest';
import { stripTorBoxToken } from './torboxLinkSecret';

describe('stripTorBoxToken', () => {
	it('removes the API key that TorBox puts in the download URL', () => {
		expect(
			stripTorBoxToken(
				'https://nexus.tb-cdn.st/dld/abc-123?token=00000000-0000-4000-8000-000000000000'
			)
		).toBe('https://nexus.tb-cdn.st/dld/abc-123');
	});

	it('keeps the other query parameters', () => {
		expect(stripTorBoxToken('https://nexus.tb-cdn.st/dld/abc?token=secret&redirect=true')).toBe(
			'https://nexus.tb-cdn.st/dld/abc?redirect=true'
		);
	});

	it('leaves a URL without a token alone', () => {
		expect(stripTorBoxToken('https://nexus.tb-cdn.st/dld/abc')).toBe(
			'https://nexus.tb-cdn.st/dld/abc'
		);
	});

	it('never returns an empty string, because the column marks a row castable', () => {
		expect(stripTorBoxToken('https://nexus.tb-cdn.st/dld/abc?token=secret')).not.toBe('');
	});

	it('does not mistake a parameter that merely ends in token', () => {
		expect(stripTorBoxToken('https://tb/dld/a?user_token=keep&token=drop')).toBe(
			'https://tb/dld/a?user_token=keep'
		);
	});
});
