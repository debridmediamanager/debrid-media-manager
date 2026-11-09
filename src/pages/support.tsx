import { PolicyPage } from '@/components/PolicyPage';
import Link from 'next/link';

const EMAIL = 'support@debridmediamanager.com';

/** The support page App Store and Google Play link to for DMM Mobile. */
export default function SupportPage() {
	return (
		<PolicyPage
			title="Help and support"
			intro={
				<p>
					DMM Mobile shows and manages the files in your own debrid account on your phone,
					tablet or TV, and plays them in the player app you choose.
				</p>
			}
		>
			<section>
				<h2>Getting started</h2>
				<ul>
					<li>
						You need an account with at least one debrid service: Real-Debrid,
						AllDebrid, TorBox, Premiumize, Offcloud or Debrid-Link. The app does not
						sell one.
					</li>
					<li>
						On a phone or tablet, open Accounts and sign in to the service, or paste its
						API key.
					</li>
					<li>
						On a TV, scan the code with a phone that is signed in to
						debridmediamanager.com, or choose &ldquo;Enter an API key instead&rdquo;.
					</li>
					<li>
						To look around without an account, enter <code>dmmdemo</code> as the API key
						of any service. It opens a sample library of open movies.
					</li>
				</ul>
			</section>
			<section>
				<h2>Common questions</h2>
				<ul>
					<li>
						<strong>A video does not open.</strong> Choose a player in Settings, under
						&ldquo;Open videos with&rdquo;, and make sure that app is installed.
					</li>
					<li>
						<strong>My logins came back on a new device.</strong> The app remembers them
						across devices. See the <Link href="/privacy">privacy policy</Link> for how
						to remove them.
					</li>
				</ul>
			</section>
			<section>
				<h2>Contact</h2>
				<p>
					Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> or ask on our{' '}
					<a href="https://discord.com/invite/7u4YjMThXP">Discord</a>. To report copyright
					infringement, use the <Link href="/copyright">copyright notice</Link> form.
				</p>
			</section>
		</PolicyPage>
	);
}
