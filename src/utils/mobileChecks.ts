import toast from 'react-hot-toast';

export const landscapeMode = () => {
	const showWarning = () =>
		toast(
			'You are using a mobile device in portrait mode but *landscape mode* is the best option for Debrid Media Manager',
			{
				icon: '📱',
				duration: 10000,
			}
		);
	const isPortrait = () => window.matchMedia('(orientation: portrait)').matches;
	if (isMobileDevice() && isPortrait()) showWarning();
	const handleOrientationChange = () => {
		if (isMobileDevice() && isPortrait()) showWarning();
	};
	window.addEventListener('orientationchange', handleOrientationChange);
	return () => {
		window.removeEventListener('orientationchange', handleOrientationChange);
	};
};

export const isMobileDevice = () =>
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
