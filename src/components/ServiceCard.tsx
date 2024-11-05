import { AllDebridUser, RealDebridUser } from '@/hooks/auth';
import { TraktUser } from '@/services/trakt';
import Link from 'next/link';
import Swal from 'sweetalert2';

interface ServiceCardProps {
	service: 'rd' | 'ad' | 'trakt';
	user: RealDebridUser | AllDebridUser | TraktUser | null;
	onTraktLogin: () => void;
	onLogout: (prefix: string) => void;
}

export function ServiceCard({ service, user, onTraktLogin, onLogout }: ServiceCardProps) {
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

		Swal.fire({
			title,
			html,
			showCancelButton: true,
			confirmButtonText: 'Close',
			cancelButtonText: 'Logout',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			reverseButtons: true,
		}).then((result) => {
			if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {
				Swal.fire({
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

	if (service === 'rd') {
		const rdUser = user as RealDebridUser | null;
		return rdUser ? (
			<button
				onClick={() => showUserInfo('rd')}
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 transition-colors haptic"
			>
				<span className="font-medium">Real-Debrid</span>
				<span>{rdUser.username}</span>
				<span>{rdUser.premium ? '✅' : '❌'}</span>
			</button>
		) : (
			<Link
				href="/realdebrid/login"
				className="w-full text-center py-3 rounded border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 transition-colors haptic"
			>
				Login with Real-Debrid
			</Link>
		);
	}

	if (service === 'ad') {
		const adUser = user as AllDebridUser | null;
		return adUser ? (
			<button
				onClick={() => showUserInfo('ad')}
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50 transition-colors haptic"
			>
				<span className="font-medium">AllDebrid</span>
				<span>{adUser.username}</span>
				<span>{adUser.isPremium ? '✅' : '❌'}</span>
			</button>
		) : (
			<Link
				href="/alldebrid/login"
				className="w-full text-center py-3 rounded border-2 border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50 transition-colors haptic"
			>
				Login with AllDebrid
			</Link>
		);
	}

	if (service === 'trakt') {
		const traktUser = user as TraktUser | null;
		return traktUser ? (
			<button
				onClick={() => showUserInfo('trakt')}
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors haptic"
			>
				<span className="font-medium">Trakt</span>
				<span>{traktUser.user.username}</span>
				<span className="text-green-500">✅</span>
			</button>
		) : (
			<button
				onClick={onTraktLogin}
				className="w-full text-center py-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors haptic"
			>
				Login with Trakt
			</button>
		);
	}

	return null;
}
