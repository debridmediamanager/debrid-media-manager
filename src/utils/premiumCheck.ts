import { RealDebridUser } from '@/hooks/auth';
import Modal from '../components/modals/modal';
import { REAL_DEBRID_PREMIUM_REFERRAL_URL } from './referrals';

export async function checkPremiumStatus(rdUser: RealDebridUser) {
	// Calculate days remaining either from premium seconds or expiration date
	const daysRemaining = rdUser.premium
		? Math.floor(rdUser.premium / (24 * 60 * 60)) // Convert seconds to days
		: Math.floor((new Date(rdUser.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

	if (!rdUser.premium) {
		const result = await Modal.fire({
			title: 'Premium Required',
			text: 'This app is only available to Real-Debrid Premium users. Click OK to become premium now.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Become Premium now',
			cancelButtonText: 'Cancel',
		});

		if (result.isConfirmed) {
			window.open(REAL_DEBRID_PREMIUM_REFERRAL_URL, '_blank');
		}
		return { shouldLogout: true };
	}

	if (daysRemaining <= 7) {
		const now = Date.now();
		const lastWarning = parseInt(localStorage.getItem('rd_premium_warning') || '0');
		if (now - lastWarning >= 24 * 60 * 60 * 1000) {
			// 24 hours in milliseconds
			const result = await Modal.fire({
				title: 'Premium Expiring Soon',
				text: `Your Real-Debrid premium subscription will expire in ${daysRemaining} days. Click OK to renew now.`,
				icon: 'warning',
				showCancelButton: true,
				confirmButtonText: 'Renew Premium now',
				cancelButtonText: 'Later',
			});

			if (result.isConfirmed) {
				window.open(REAL_DEBRID_PREMIUM_REFERRAL_URL, '_blank');
			}
			localStorage.setItem('rd_premium_warning', now.toString());
		}
	}

	return { shouldLogout: false };
}
