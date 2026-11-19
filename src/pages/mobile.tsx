import { PolicyPage } from '@/components/PolicyPage';
import {
	MOBILE_ALTSTORE_SOURCE,
	MOBILE_LATEST_API,
	MOBILE_RELEASES_URL,
	pickMobileApks,
	pickMobileIpa,
} from '@/utils/mobileApks';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const PLAY_GROUP = 'https://groups.google.com/g/dmm-mobile-beta';
const PLAY_OPT_IN = 'https://play.google.com/apps/testing/com.debridmediamanager.library';

const ADD_SOURCE = `source?url=${encodeURIComponent(MOBILE_ALTSTORE_SOURCE)}`;
const BUTTON =
	'mt-1 inline-block rounded bg-cyan-700 px-4 py-2 font-semibold !text-white !no-underline hover:bg-cyan-600';

/** Where to get DMM Mobile: the APK from GitHub or the Google Play test, and the iOS build for AltStore or SideStore. */
export default function MobilePage() {
	// The release page until GitHub names the newest files.
	const [apks, setApks] = useState({ arm64: MOBILE_RELEASES_URL, armv7: MOBILE_RELEASES_URL });
	const [ipa, setIpa] = useState(MOBILE_RELEASES_URL);
	useEffect(() => {
		fetch(MOBILE_LATEST_API)
			.then((response) => response.json())
			.then((release) => {
				const { arm64, armv7 } = pickMobileApks(release);
				setApks({
					arm64: arm64 ?? MOBILE_RELEASES_URL,
					armv7: armv7 ?? MOBILE_RELEASES_URL,
				});
			})
			.catch(() => undefined);
		fetch(MOBILE_ALTSTORE_SOURCE)
			.then((response) => response.json())
			.then((source) => setIpa(pickMobileIpa(source) ?? MOBILE_RELEASES_URL))
			.catch(() => undefined);
	}, []);

	return (
		<PolicyPage
			title="DMM Mobile"
			intro={
				<p>
					Debrid Media Manager for phones, tablets and TVs. It shows the films and shows
					in your own debrid account and plays them. It is free.
				</p>
			}
		>
			<section>
				<h2>Android phones, tablets and TVs</h2>
				<a href={apks.arm64} className={BUTTON}>
					Download for Android
				</a>
				<p className="mt-3">
					That file fits most phones, tablets and TV boxes. Fire TV and older 32-bit boxes
					take <a href={apks.armv7}>the armeabi-v7a file</a>. Android 7 or newer. Install
					a newer file over the old one to update, or switch on Settings, Get fixes
					automatically. Every version is on <a href={MOBILE_RELEASES_URL}>GitHub</a>.
				</p>
			</section>
			<section>
				<h2>Google Play</h2>
				<p>
					DMM Mobile is a closed test on Google Play for now. Join the{' '}
					<a href={PLAY_GROUP}>dmm-mobile-beta group</a>, then open the{' '}
					<a href={PLAY_OPT_IN}>test page</a> with the same Google account and tap Become
					a tester.
				</p>
				<p>
					The Play build and the downloaded file are signed differently, so one does not
					update the other. Uninstall one before you install the other.
				</p>
			</section>
			<section>
				<h2>iPhone and iPad</h2>
				<p>
					DMM Mobile is not on the App Store yet. Install it with{' '}
					<a href="https://altstore.io/">AltStore</a> or{' '}
					<a href="https://sidestore.io/">SideStore</a>, which sign it with your own Apple
					ID. Open this page on the iPhone or iPad and tap the button for the app you
					have:
				</p>
				<p className="flex flex-wrap gap-2">
					<a href={`altstore://${ADD_SOURCE}`} className={BUTTON}>
						Add to AltStore
					</a>
					<a href={`sidestore://${ADD_SOURCE}`} className={BUTTON}>
						Add to SideStore
					</a>
				</p>
				<p className="mt-3">
					That adds the DMM Mobile source. Install the app from it, and updates arrive the
					same way. iOS 16.4 or newer. If the buttons do nothing, paste this address into
					the Sources tab:
				</p>
				<p className="break-all">
					<code>{MOBILE_ALTSTORE_SOURCE}</code>
				</p>
				<p>
					Sideloadly and other tools take <a href={ipa}>the .ipa file</a>. With a free
					Apple ID the app has to be refreshed every 7 days, which AltStore and SideStore
					do for you.
				</p>
			</section>
			<section>
				<h2>Apple TV</h2>
				<p>Not available yet.</p>
			</section>
			<section>
				<h2>Help</h2>
				<p>
					Setup steps and common questions are on the{' '}
					<Link href="/support">support page</Link>. The{' '}
					<Link href="/privacy">privacy policy</Link> says what the app sends and where.
				</p>
			</section>
		</PolicyPage>
	);
}
