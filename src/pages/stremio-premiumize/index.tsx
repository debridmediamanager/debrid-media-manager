import { CastPage, CastPageConfig } from '@/components/CastPage';
import { usePremiumizeCastToken } from '@/hooks/premiumizeCastToken';
import { CAST_LOGOS } from '@/utils/castLogos';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'Premiumize',
	service: 'pm',
	accentColor: 'red',
	apiPrefix: 'stremio-pm',
	castPath: '/stremio-premiumize',
	loginPath: '/premiumize/login',
	logo: CAST_LOGOS.pm,
	hasCredentials: () =>
		// Either credential works: the OAuth device-code token or the API key
		!!(localStorage.getItem('pm:accessToken') || localStorage.getItem('pm:apiKey')),
	theme: {
		heading: 'text-red-400',
		icon: 'text-red-400',
		button: 'border-red-500 bg-red-800/30 hover:bg-red-700/50',
		buttonText: 'text-red-100',
		alert: 'text-red-400',
		alertBox: 'border-red-500 bg-red-900/20',
	},
};

export function StremioPremiumizePage() {
	const dmmCastToken = usePremiumizeCastToken({ enroll: true });
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioPremiumizePage)), { ssr: false });
