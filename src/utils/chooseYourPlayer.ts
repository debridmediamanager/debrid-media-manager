import Swal from 'sweetalert2';

export const defaultPlayer = 'web/rd';

export const chooseYourPlayer = async () => {
	await Swal.fire({
		title: 'Choose your player',
		input: 'select',
		inputOptions: {
			Web: {
				'web/rd': 'Real-Debrid Stream',
			},
			Android: {
				'android/chooser': 'App chooser',
				'android/org.videolan.vlc': 'VLC',
				'android/com.mxtech.videoplayer.ad': 'MX Player',
				'android/com.brouken.player': 'JustPlayer',
			},
			iOS: {
				'ios/infuse': 'Infuse',
				'ios/vlc': 'VLC',
				'ios/outplayer': 'Outplayer',
			},
			MacOS: {
				'mac/infuse': 'Infuse',
			},
		},
		inputValue: window.localStorage.getItem('player') || undefined,
		inputPlaceholder: 'Choose your player',
		showCancelButton: true,
		inputValidator: (value: string) => {
			return new Promise((resolve) => {
				if (!!value) {
					window.localStorage.setItem('player', value);
					resolve();
				} else {
					resolve('You need to choose a player');
				}
			});
		},
	});
};
