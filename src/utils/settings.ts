import Swal from 'sweetalert2';

export const defaultPlayer = 'web/rd';
export const defaultSize = '5';

export const showSettings = async () => {
	const storedPlayer = window.localStorage.getItem('player') || defaultPlayer;
	const isPlayer = (player: string) =>
		storedPlayer === player ? `value="${player}" selected` : `value="${player}"`;

	const storedMaxSize = window.localStorage.getItem('maxSize') || defaultSize;
	const isSize = (size: string) =>
		storedMaxSize === size ? `value="${size}" selected` : `value="${size}"`;

	const { value: formValues } = await Swal.fire({
		title: '⚙️ Settings',
		html: `
            <label for="dmm-player">Video player:</label>
            <select id="dmm-player" class="swal2-input">
				<optgroup label="Web">
					<option ${isPlayer('web/rd')}>Real-Debrid Stream</option>
				</optgroup>
				<optgroup label="Android">
					<option ${isPlayer('android/chooser')}>App chooser</option>
					<option ${isPlayer('android/org.videolan.vlc')}>VLC</option>
					<option ${isPlayer('android/com.mxtech.videoplayer.ad')}>MX Player</option>
					<option ${isPlayer('android/com.mxtech.videoplayer.pro')}>MX Player Pro</option>
					<option ${isPlayer('android/com.brouken.player')}>JustPlayer</option>
				</optgroup>
				<optgroup label="iOS">
					<option ${isPlayer('ios/infuse')}>Infuse</option>
					<option ${isPlayer('ios/vlc')}>VLC</option>
					<option ${isPlayer('ios/outplayer')}>Outplayer</option>
				</optgroup>
				<optgroup label="MacOS">
					<option ${isPlayer('mac/infuse')}>Infuse</option>
					<option ${isPlayer('mac2/iina')}>IINA</option>
					<option ${isPlayer('mac2/omniplayer')}>OmniPlayer</option>
					<option ${isPlayer('mac2/figplayer')}>Fig Player</option>
				</optgroup>
			</select>

			<div name="divider" class="py-2"></div>

            <label for="dmm-max-size">Biggest file size to show:</label>
            <select id="dmm-max-size" class="swal2-input">
                <option ${isSize('5')}>5 GB</option>
				<option ${isSize('15')}>15 GB</option>
				<option ${isSize('60')}>60 GB</option>
				<option ${isSize('0')}>Doesn't matter</option>
			</select>

			<div name="divider" class="py-2"></div>

			<button id="dmm-default" class="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded" onclick="() => navigator.registerProtocolHandler('magnet', '${
				window.location.origin
			}/library?addMagnet=%s')">
				🧲 Make DMM your torrent client
			</button>
        `,
		focusConfirm: false,
		preConfirm: () => {
			return {
				player: (document.getElementById('dmm-player') as HTMLInputElement).value,
				maxSize: (document.getElementById('dmm-max-size') as HTMLInputElement).value,
			};
		},
	});

	if (formValues) {
		window.localStorage.setItem('player', formValues.player);
		window.localStorage.setItem('maxSize', formValues.maxSize);
	}
};
