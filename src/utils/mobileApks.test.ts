import { describe, expect, it } from 'vitest';
import altstore from '../test/fixtures/github-dmm-mobile-altstore-2026-11-19.json';
import release from '../test/fixtures/github-dmm-mobile-release-v1.3.0.json';
import { pickMobileApks, pickMobileIpa } from './mobileApks';

// GitHub's answer for DMM Mobile's v1.3.0 release, trimmed to the fields the page reads.
describe('pickMobileApks', () => {
	it('picks the APK for each processor from the newest release', () => {
		expect(pickMobileApks(release)).toEqual({
			arm64: 'https://github.com/debridmediamanager/dmm-mobile/releases/download/v1.3.0/dmm-mobile-1.3.0-arm64-v8a.apk',
			armv7: 'https://github.com/debridmediamanager/dmm-mobile/releases/download/v1.3.0/dmm-mobile-1.3.0-armeabi-v7a.apk',
		});
	});

	it('leaves a processor out when the release has no APK for it', () => {
		const universal = { assets: [{ name: 'dmm-mobile-1.2.0.apk', browser_download_url: 'x' }] };
		expect(pickMobileApks(universal)).toEqual({ arm64: undefined, armv7: undefined });
		expect(pickMobileApks({ message: 'API rate limit exceeded' } as object)).toEqual({
			arm64: undefined,
			armv7: undefined,
		});
	});
});

// DMM Mobile's altstore.json as GitHub served it on 2026-11-19, the day the first iOS build went up.
describe('pickMobileIpa', () => {
	it('picks the newest iOS build from the AltStore source', () => {
		expect(pickMobileIpa(altstore)).toBe(
			'https://github.com/debridmediamanager/dmm-mobile/releases/download/v1.3.0/dmm-mobile-1.3.0-5-ios.ipa'
		);
	});

	it('finds nothing in an answer that is not a source', () => {
		expect(pickMobileIpa({})).toBeUndefined();
		expect(pickMobileIpa({ apps: [{ versions: [] }] })).toBeUndefined();
	});
});
