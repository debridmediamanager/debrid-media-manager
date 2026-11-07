import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useEasynewsCastToken } from '@/hooks/easynewsCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const hasEasynewsLogin = () => {
	try {
		const account = JSON.parse(localStorage.getItem('en:account') || 'null');
		return !!(account?.username && account?.password);
	} catch {
		return false;
	}
};

const config: CastPageConfig = {
	name: 'Easynews',
	service: 'en',
	accentColor: 'blue',
	apiPrefix: 'stremio-en',
	castPath: '/stremio-easynews',
	// The Easynews login lives in Settings' Easynews panel, which returns here.
	loginPath: '/settings',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	hasCredentials: hasEasynewsLogin,
	theme: {
		heading: 'text-blue-400',
		icon: 'text-blue-400',
		button: 'border-blue-500 bg-blue-800/30 hover:bg-blue-700/50',
		buttonText: 'text-blue-100',
		alert: 'text-blue-400',
		alertBox: 'border-blue-500 bg-blue-900/20',
	},
};

export function StremioEasynewsPage() {
	const dmmCastToken = useEasynewsCastToken({ enroll: true });
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioEasynewsPage)), { ssr: false });
