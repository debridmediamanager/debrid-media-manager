/** DMM Mobile's public releases; the /mobile page links here until it knows the newest APKs. */
export const MOBILE_RELEASES_URL =
	'https://github.com/debridmediamanager/dmm-mobile/releases/latest';
export const MOBILE_LATEST_API =
	'https://api.github.com/repos/debridmediamanager/dmm-mobile/releases/latest';

type Release = { assets?: { name: string; browser_download_url: string }[] };

/** The newest release's APK per processor. Its files carry the version (dmm-mobile-1.3.0-arm64-v8a.apk). */
export function pickMobileApks(release: Release): { arm64?: string; armv7?: string } {
	const url = (abi: string) =>
		release.assets?.find(
			(a) => /^dmm-mobile-[\d.]+-/.test(a.name) && a.name.endsWith(`-${abi}.apk`)
		)?.browser_download_url;
	return { arm64: url('arm64-v8a'), armv7: url('armeabi-v7a') };
}

/** The AltStore/SideStore source for the iPhone and iPad build, kept in DMM Mobile's repository. */
export const MOBILE_ALTSTORE_SOURCE =
	'https://raw.githubusercontent.com/debridmediamanager/dmm-mobile/main/altstore.json';

type AltSource = { apps?: { versions?: { downloadURL?: string }[] }[] };

/** The newest iOS build's file: the first version the source lists. */
export const pickMobileIpa = (source: AltSource): string | undefined =>
	source.apps?.[0]?.versions?.[0]?.downloadURL;
