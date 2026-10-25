import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useCastToken } from '@/hooks/castToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'Real-Debrid',
	service: 'rd',
	accentColor: 'green',
	apiPrefix: 'stremio',
	castPath: '/stremio',
	loginPath: '/realdebrid/login',
	logo: 'https://static.debridmediamanager.com/greenlogo.jpeg',
	hasCredentials: () =>
		// The access token alone, matching every other provider's cast page
		// and `withAuth`. Demanding the whole OAuth quad locked out anyone
		// who signed in with a pasted API key, which stores nothing else -
		// and the login they were sent to returned them home, so the page
		// asked for the key again, forever.
		!!localStorage.getItem('rd:accessToken'),
	theme: {
		heading: 'text-green-400',
		icon: 'text-green-400',
		button: 'border-green-500 bg-green-800/30 hover:bg-green-700/50',
		buttonText: 'text-green-100',
		alert: 'text-red-400',
		alertBox: 'border-red-500 bg-red-900/20',
	},
};

export function StremioPage() {
	const dmmCastToken = useCastToken();
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioPage)), { ssr: false });
