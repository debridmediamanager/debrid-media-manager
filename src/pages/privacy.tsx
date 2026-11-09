import { PolicyPage } from '@/components/PolicyPage';

const EMAIL = 'support@debridmediamanager.com';

/** The privacy policy App Store and Google Play link to for DMM Mobile. */
export default function PrivacyPage() {
	return (
		<PolicyPage
			title="Privacy policy"
			intro={
				<p>
					For DMM Mobile, the Debrid Media Manager app for phones, tablets and TVs. Last
					updated 9 November 2026.
				</p>
			}
		>
			<section>
				<h2>The short version</h2>
				<ul>
					<li>No accounts of our own, no ads, no analytics or tracking tools.</li>
					<li>We never sell or share your data for advertising.</li>
					<li>Your debrid logins stay on your device, except as described below.</li>
				</ul>
			</section>
			<section>
				<h2>Your debrid logins</h2>
				<p>
					You sign in to debrid services such as Real-Debrid, AllDebrid, TorBox,
					Premiumize, Offcloud or Debrid-Link. The app keeps those logins in your
					device&rsquo;s secure storage (the iOS Keychain or Android&rsquo;s encrypted
					storage) and sends each one only to the service it belongs to, which is also
					where your library and files come from.
				</p>
			</section>
			<section>
				<h2>Remembered across devices</h2>
				<p>
					The app saves your logins and its settings on our server, so signing in to one
					service on another device, or on debridmediamanager.com, brings the others back.
					We check each login with its service before saving, store the copy behind it,
					and hand it back only to someone who signs in with one of those logins.
				</p>
				<p>
					A service you disconnect in the app is removed from the saved copy. To delete
					the copy completely, open Settings on the website, sign in, and untick
					&ldquo;Remember my logins and settings across devices&rdquo;, or email us.
				</p>
			</section>
			<section>
				<h2>Search and opening pages</h2>
				<p>
					What you type in Search goes to our server, which looks it up with Trakt and an
					anime catalogue. Posters load straight from their image servers, which see your
					IP address. When you open a result, the app hands your logins to our server
					behind a one-time code, so the page opens signed in. We delete them as soon as
					the page takes them, or after two minutes.
				</p>
				<p>
					Signing in a TV from your phone works the same way: the logins wait on our
					server for at most ten minutes and are handed to that TV once.
				</p>
			</section>
			<section>
				<h2>What our server keeps about you</h2>
				<ul>
					<li>The saved copy described above, until you delete it.</li>
					<li>
						Your IP address, for up to a day, to limit how often an address can make
						requests, and in server logs that we delete after a short time.
					</li>
				</ul>
				<p>
					Playing a file streams it from your debrid service, or hands it to the player
					app you chose; we do not see what you watch.
				</p>
			</section>
			<section>
				<h2>Children</h2>
				<p>The app is not meant for children under 13.</p>
			</section>
			<section>
				<h2>Your rights and contact</h2>
				<p>
					Debrid Media Manager is run by Ben Adrian Sarmiento. To see, correct or delete
					what we keep about you, or for any privacy question, email{' '}
					<a href={`mailto:${EMAIL}`}>{EMAIL}</a>. If this policy changes, the date at the
					top changes with it.
				</p>
			</section>
		</PolicyPage>
	);
}
