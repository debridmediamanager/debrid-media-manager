import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useDebridLinkCastToken } from '@/hooks/debridLinkCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'Debrid-Link',
	service: 'dl',
	accentColor: 'sky',
	apiPrefix: 'stremio-dl',
	castPath: '/stremio-debridlink',
	loginPath: '/debridlink/login',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	hasCredentials: () =>
		// Either credential works: an OAuth access token from the device-code
		// login, or a token pasted from the account page. Both go in the same
		// Bearer header.
		!!(localStorage.getItem('dl:accessToken') || localStorage.getItem('dl:apiKey')),
	theme: {
		heading: 'text-sky-400',
		icon: 'text-sky-400',
		button: 'border-sky-500 bg-sky-800/30 hover:bg-sky-700/50',
		buttonText: 'text-sky-100',
		alert: 'text-sky-400',
		alertBox: 'border-sky-500 bg-sky-900/20',
	},
	notice: (
		<div className="mt-4 max-w-md rounded border border-sky-700 bg-sky-900/20 p-3 text-center text-xs text-sky-100">
			Debrid-Link has no cache check, so casting a release adds it to your seedbox. One that
			is already cached is ready in about a second; one that is not starts downloading for
			real and uses one of your 50 torrents for the day.
		</div>
	),
};

export function StremioDebridLinkPage() {
	const dmmCastToken = useDebridLinkCastToken({ enroll: true });
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioDebridLinkPage)), { ssr: false });
