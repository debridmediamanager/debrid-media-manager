import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'TorBox',
	service: 'tb',
	accentColor: 'purple',
	apiPrefix: 'stremio-tb',
	castPath: '/stremio-torbox',
	loginPath: '/torbox/login',
	logo: 'https://static.debridmediamanager.com/dmmcast.png',
	hasCredentials: () => !!localStorage.getItem('tb:apiKey'),
	theme: {
		heading: 'text-purple-400',
		icon: 'text-purple-400',
		button: 'border-purple-500 bg-purple-800/30 hover:bg-purple-700/50',
		buttonText: 'text-purple-100',
		alert: 'text-red-400',
		alertBox: 'border-red-500 bg-red-900/20',
		popcorn: 'text-yellow-500',
	},
};

export function StremioTorBoxPage() {
	const dmmCastToken = useTorBoxCastToken();
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioTorBoxPage)), { ssr: false });
