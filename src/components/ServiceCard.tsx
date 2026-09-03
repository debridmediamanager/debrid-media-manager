import {
	AllDebridUser,
	DebridLinkUser,
	OffcloudUser,
	PremiumizeUser,
	RealDebridUser,
} from '@/hooks/auth';
import { debridLinkPremiumDaysLeft, isDebridLinkPremium } from '@/services/debridLink';
import { isOffcloudPremium } from '@/services/offcloud';
import { isPremiumizePremium } from '@/services/premiumize';
import { TraktUser } from '@/services/trakt';
import { TorBoxUser } from '@/services/types';
import { Check, X } from 'lucide-react';
import Modal from '../components/modals/modal';

interface ServiceCardProps {
	service: 'rd' | 'ad' | 'tb' | 'pm' | 'oc' | 'dl' | 'trakt';
	user: RealDebridUser | AllDebridUser | TraktUser | any | null;
	onTraktLogin: () => void;
	onLogout: (prefix: string) => void;
	/** The provider answered, but with a failure - see the note on the branch below. */
	error?: Error | null;
}

const SERVICE_LABELS: Record<ServiceCardProps['service'], string> = {
	rd: 'Real-Debrid',
	ad: 'AllDebrid',
	tb: 'TorBox',
	pm: 'Premiumize',
	oc: 'Offcloud',
	dl: 'Debrid-Link',
	trakt: 'Trakt',
};

/**
 * The localStorage key prefix `handleLogout` sweeps for each service. The
 * connected card derives the same value inside `showUserInfo`, but the error
 * card never reaches that branch - it has no profile to show - so the mapping
 * has to exist independently of it.
 */
const SERVICE_PREFIXES: Record<ServiceCardProps['service'], string> = {
	rd: 'rd:',
	ad: 'ad:',
	tb: 'tb:',
	pm: 'pm:',
	oc: 'oc:',
	dl: 'dl:',
	trakt: 'trakt:',
};

export function ServiceCard({ service, user, onTraktLogin, onLogout, error }: ServiceCardProps) {
	const formatBytes = (bytes: number) => {
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		if (bytes === 0) return '0 B';
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
	};

	const showUserInfo = (service: string) => {
		let title = '';
		let html = '';
		let prefix = '';

		if (service === 'rd' && user && 'premium' in user) {
			const rdUser = user as RealDebridUser;
			const daysRemaining = rdUser.premium
				? Math.floor(rdUser.premium / (24 * 60 * 60))
				: Math.floor(
						(new Date(rdUser.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
					);

			title = 'Real-Debrid';
			prefix = 'rd:';
			html = `
        <div class="text-left">
          <p><strong>Username:</strong> ${rdUser.username}</p>
          <p><strong>Email:</strong> ${rdUser.email}</p>
          <p><strong>Points:</strong> ${rdUser.points}</p>
          <p><strong>Type:</strong> ${rdUser.type}</p>
          <p><strong>Days Remaining:</strong> ${daysRemaining}</p>
        </div>
      `;
		} else if (service === 'ad' && user && 'isPremium' in user) {
			const adUser = user as AllDebridUser;
			title = 'AllDebrid';
			prefix = 'ad:';
			html = `
        <div class="text-left">
          <p><strong>Username:</strong> ${adUser.username}</p>
          <p><strong>Email:</strong> ${adUser.email}</p>
          <p><strong>Type:</strong> ${adUser.isPremium ? 'premium' : 'free'}</p>
          <p><strong>Premium Until:</strong> ${new Date(adUser.premiumUntil * 1000).toLocaleDateString()}</p>
		  <p><strong>Points:</strong> ${adUser.fidelityPoints}</p>
        </div>
      `;
		} else if (service === 'tb' && user) {
			const tbUser = user as TorBoxUser;
			title = 'Torbox';
			prefix = 'tb:';
			const premiumExpiry = new Date(tbUser.premium_expires_at);
			const isPremiumActive = premiumExpiry > new Date();

			html = `
        <div class="text-left">
          <p><strong>Email:</strong> ${tbUser.email}</p>
          <p><strong>Created:</strong> ${tbUser.created_at ? new Date(tbUser.created_at).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Plan:</strong> ${
				tbUser.plan === 2
					? 'Pro'
					: tbUser.plan === 1
						? 'Standard'
						: tbUser.plan === 0
							? 'Essential'
							: `Free`
			}</p>
          <p><strong>Premium Status:</strong> ${isPremiumActive ? 'Active' : 'Inactive'}</p>
          <p><strong>Premium Expires:</strong> ${tbUser.premium_expires_at ? new Date(tbUser.premium_expires_at).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Downloads:</strong> ${tbUser.total_downloaded} torrents</p>
          ${
				tbUser.cooldown_until && new Date(tbUser.cooldown_until) > new Date()
					? `<p><strong>Cooldown Until:</strong> ${new Date(tbUser.cooldown_until).toLocaleDateString()}</p>`
					: ''
			}
          ${tbUser.user_referral ? `<p><strong>Referral Code:</strong> ${tbUser.user_referral}</p>` : ''}
        </div>
      `;
		} else if (service === 'pm' && user && 'customer_id' in user) {
			const pmUser = user as PremiumizeUser;
			title = 'Premiumize';
			prefix = 'pm:';
			// limit_used is the fraction of a rolling 1000-point pool, and one
			// point is exactly one GiB - not one GB, which understates spend by 7%.
			const pointsUsed = pmUser.limit_used * 1000;
			html = `
        <div class="text-left">
          <p><strong>Customer ID:</strong> ${pmUser.customer_id}</p>
          <p><strong>Premium Until:</strong> ${
				pmUser.premium_until
					? new Date(pmUser.premium_until * 1000).toLocaleDateString()
					: 'Free account'
			}</p>
          <p><strong>Fair use:</strong> ${pointsUsed.toFixed(1)} of 1000 points (${(
				pmUser.limit_used * 100
			).toFixed(2)}%)</p>
          <p><strong>Cloud storage used:</strong> ${formatBytes(pmUser.space_used)} of 1 TB</p>
          <p><strong>Booster points:</strong> ${pmUser.booster_points}</p>
        </div>
      `;
		} else if (service === 'oc' && user && 'is_premium' in user) {
			const ocUser = user as OffcloudUser;
			title = 'Offcloud';
			prefix = 'oc:';
			// `account/info` is the entire introspection surface - no bandwidth
			// counter, no quota, no plan name, and `expiration_date` is a
			// `YYYY-MM-DD` string rather than a timestamp.
			html = `
      <div class="text-left">
        <p><strong>Email:</strong> ${ocUser.email}</p>
        <p><strong>User ID:</strong> ${ocUser.user_id}</p>
        <p><strong>Type:</strong> ${ocUser.is_premium ? 'premium' : 'free'}</p>
        <p><strong>Premium Until:</strong> ${ocUser.expiration_date || 'N/A'}</p>
        <p><strong>Can Download:</strong> ${ocUser.can_download ? 'Yes' : 'No'}</p>
      </div>
    `;
		} else if (service === 'dl' && user && 'accountType' in user) {
			const dlUser = user as DebridLinkUser;
			title = 'Debrid-Link';
			prefix = 'dl:';
			// `premiumLeft` is **seconds remaining**, not a timestamp - reading
			// it as one dates the account to 1970.
			html = `
      <div class="text-left">
        <p><strong>Username:</strong> ${dlUser.username}</p>
        <p><strong>Email:</strong> ${dlUser.email}</p>
        <p><strong>Points:</strong> ${dlUser.pts}</p>
        <p><strong>Type:</strong> ${isDebridLinkPremium(dlUser) ? 'premium' : 'free'}</p>
        <p><strong>Days Remaining:</strong> ${debridLinkPremiumDaysLeft(dlUser)}</p>
      </div>
    `;
		} else if (service === 'trakt' && user && 'user' in user) {
			const traktUser = user as TraktUser;
			title = 'Trakt';
			prefix = 'trakt:';
			html = `
        <div class="text-left">
          <p><strong>Username:</strong> ${traktUser.user.username}</p>
          <p><strong>Joined:</strong> ${new Date(traktUser.user.joined_at).toLocaleDateString()}</p>
          <p><strong>Private:</strong> ${traktUser.user.private ? 'Yes' : 'No'}</p>
          <p><strong>VIP:</strong> ${traktUser.user.vip ? 'Yes' : 'No'}</p>
        </div>
      `;
		}

		Modal.fire({
			title,
			html,
			showCancelButton: true,
			confirmButtonText: 'Close',
			cancelButtonText: 'Logout',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
		}).then((result) => {
			if (result.isDismissed && result.dismiss === Modal.DismissReason.cancel) {
				Modal.fire({
					title: 'Confirm Logout',
					text: `Are you sure you want to logout from ${title}?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonText: 'Yes, logout',
					cancelButtonText: 'No, cancel',
					confirmButtonColor: '#d33',
					cancelButtonColor: '#3085d6',
				}).then((confirmResult) => {
					if (confirmResult.isConfirmed) {
						onLogout(prefix);
					}
				});
			}
		});
	};

	const confirmErrorLogout = () => {
		const label = SERVICE_LABELS[service];
		Modal.fire({
			title: 'Confirm Logout',
			text: `Are you sure you want to logout from ${label}?`,
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Yes, logout',
			cancelButtonText: 'No, cancel',
			confirmButtonColor: '#d33',
			cancelButtonColor: '#3085d6',
		}).then((result) => {
			if (result.isConfirmed) {
				onLogout(SERVICE_PREFIXES[service]);
			}
		});
	};

	// Without this a provider whose profile call failed falls through to its
	// own `user ? connected : login` branch and renders the login button - so a
	// signed-in user is told to sign in, with no hint that anything went wrong.
	//
	// Retry alone is not enough to stand here, though. A revoked or rotated
	// credential fails identically on every attempt - Premiumize answers a dead
	// key `authentication_failed` forever - and this card replaces the very one
	// that carries the provider's logout, so a retry-only card traps the user:
	// the only escape from one broken service is "Logout All", which drops the
	// five that still work. Sign-in replaces the credential in place; logout
	// clears it.
	if (error) {
		const actionClasses =
			'haptic-sm rounded border border-red-400/60 bg-red-950/40 px-2 py-1 text-xs font-medium text-red-100 transition-colors hover:bg-red-800/60';
		return (
			<div className="rounded border-2 border-red-500 bg-red-900/30 p-2 text-red-100">
				<p className="text-center text-sm">{SERVICE_LABELS[service]} did not load</p>
				<p className="mt-0.5 text-center text-xs text-red-200/70">
					If the key was revoked or replaced, retrying cannot help &mdash; sign in again
					or log out.
				</p>
				<div className="mt-2 grid grid-cols-3 gap-2">
					<button
						type="button"
						onClick={() => window.location.reload()}
						className={actionClasses}
					>
						Retry
					</button>
					<button type="button" onClick={onTraktLogin} className={actionClasses}>
						Sign in again
					</button>
					<button type="button" onClick={confirmErrorLogout} className={actionClasses}>
						Log out
					</button>
				</div>
			</div>
		);
	}

	if (service === 'rd') {
		const rdUser = user as RealDebridUser | null;
		return rdUser ? (
			<button
				onClick={() => showUserInfo('rd')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-green-500 bg-green-900/30 p-1 text-green-100 transition-colors hover:bg-green-800/50"
			>
				<span className="font-medium">Real-Debrid</span>
				<span>{rdUser.username}</span>
				{rdUser.premium ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-green-500 bg-green-900/30 py-1 text-center text-green-100 transition-colors hover:bg-green-800/50"
			>
				Real-Debrid Login
			</button>
		);
	}

	if (service === 'ad') {
		const adUser = user as AllDebridUser | null;
		return adUser ? (
			<button
				onClick={() => showUserInfo('ad')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-yellow-500 bg-yellow-900/30 p-1 text-yellow-100 transition-colors hover:bg-yellow-800/50"
			>
				<span className="font-medium">AllDebrid</span>
				<span>{adUser.username}</span>
				{adUser.isPremium ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-yellow-500 bg-yellow-900/30 py-1 text-center text-yellow-100 transition-colors hover:bg-yellow-800/50"
			>
				AllDebrid Login
			</button>
		);
	}

	if (service === 'tb') {
		const tbUser = user as TorBoxUser | null;
		const isPremiumActive = tbUser?.premium_expires_at
			? new Date(tbUser.premium_expires_at) > new Date()
			: false;
		return tbUser ? (
			<button
				onClick={() => showUserInfo('tb')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-purple-500 bg-purple-900/30 p-1 text-purple-100 transition-colors hover:bg-purple-800/50"
			>
				<span className="font-medium">Torbox</span>
				<span>{tbUser.email.split('@')[0]}</span>
				{isPremiumActive ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-purple-500 bg-purple-900/30 py-1 text-center text-purple-100 transition-colors hover:bg-purple-800/50"
			>
				Torbox Login
			</button>
		);
	}

	if (service === 'pm') {
		const pmUser = user as PremiumizeUser | null;
		// Premiumize's own icon colour, so the badge cannot be mistaken for
		// Real-Debrid green, AllDebrid amber or TorBox indigo.
		return pmUser ? (
			<button
				onClick={() => showUserInfo('pm')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-[#aa0000] bg-[#aa0000]/30 p-1 text-red-100 transition-colors hover:bg-[#aa0000]/50"
			>
				<span className="font-medium">Premiumize</span>
				<span>{pmUser.customer_id}</span>
				{isPremiumizePremium(pmUser) ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-[#aa0000] bg-[#aa0000]/30 py-1 text-center text-red-100 transition-colors hover:bg-[#aa0000]/50"
			>
				Premiumize Login
			</button>
		);
	}

	if (service === 'oc') {
		const ocUser = user as OffcloudUser | null;
		// Offcloud orange, far enough from AllDebrid's amber to tell apart in a
		// column of badges. Written out in full because Tailwind only keeps
		// arbitrary-value classes it can find as literals.
		return ocUser ? (
			<button
				onClick={() => showUserInfo('oc')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-[#f97316] bg-[#f97316]/30 p-1 text-orange-100 transition-colors hover:bg-[#f97316]/50"
			>
				<span className="font-medium">Offcloud</span>
				<span>{ocUser.email?.split('@')[0]}</span>
				{isOffcloudPremium(ocUser) ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-[#f97316] bg-[#f97316]/30 py-1 text-center text-orange-100 transition-colors hover:bg-[#f97316]/50"
			>
				Offcloud Login
			</button>
		);
	}

	if (service === 'dl') {
		const dlUser = user as DebridLinkUser | null;
		// Debrid-Link sky blue, far enough from TorBox's indigo to tell apart
		// in a column of badges. Written out in full because Tailwind only
		// keeps arbitrary-value classes it can find as literals.
		return dlUser ? (
			<button
				onClick={() => showUserInfo('dl')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-[#38bdf8] bg-[#38bdf8]/30 p-1 text-sky-100 transition-colors hover:bg-[#38bdf8]/50"
			>
				<span className="font-medium">Debrid-Link</span>
				<span>{dlUser.username}</span>
				{isDebridLinkPremium(dlUser) ? (
					<Check className="h-4 w-4 text-green-500" />
				) : (
					<X className="h-4 w-4 text-red-500" />
				)}
			</button>
		) : (
			<button
				type="button"
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-[#38bdf8] bg-[#38bdf8]/30 py-1 text-center text-sky-100 transition-colors hover:bg-[#38bdf8]/50"
			>
				Debrid-Link Login
			</button>
		);
	}

	if (service === 'trakt') {
		const traktUser = user as TraktUser | null;
		return traktUser ? (
			<button
				onClick={() => showUserInfo('trakt')}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-1 text-red-100 transition-colors hover:bg-red-800/50"
			>
				<span className="font-medium">Trakt</span>
				<span>{traktUser.user.username}</span>
				<Check className="h-4 w-4 text-green-400" />
			</button>
		) : (
			<button
				onClick={onTraktLogin}
				className="haptic w-full rounded border-2 border-red-500 bg-red-900/30 py-1 text-center text-red-100 transition-colors hover:bg-red-800/50"
			>
				Trakt Login
			</button>
		);
	}

	return null;
}
