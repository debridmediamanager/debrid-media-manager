import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'AllDebrid',
	service: 'ad',
	accentColor: 'yellow',
	apiPrefix: 'stremio-ad',
	castPath: '/stremio-alldebrid',
	loginPath: '/alldebrid/login',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	hasCredentials: () => !!localStorage.getItem('ad:apiKey'),
	theme: {
		heading: 'text-yellow-400',
		icon: 'text-yellow-400',
		button: 'border-yellow-500 bg-yellow-800/30 hover:bg-yellow-700/50',
		buttonText: 'text-yellow-100',
		alert: 'text-red-400',
		alertBox: 'border-red-500 bg-red-900/20',
	},
};

export function StremioAllDebridPage() {
	const dmmCastToken = useAllDebridCastToken({ enroll: true });
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioAllDebridPage)), { ssr: false });
