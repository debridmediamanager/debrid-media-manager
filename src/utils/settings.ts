import Swal from 'sweetalert2';

export const defaultPlayer = 'web/rd';
export const defaultMovieSize = '0';
export const defaultEpisodeSize = '0';

export const showSettings = async () => {
	const storedPlayer = window.localStorage.getItem('player') || defaultPlayer;
	const isPlayer = (player: string) =>
		storedPlayer === player ? `value="${player}" selected` : `value="${player}"`;

	const movieMaxSize = window.localStorage.getItem('movieMaxSize') || defaultMovieSize;
	const isMovieSize = (size: string) =>
		movieMaxSize === size ? `value="${size}" selected` : `value="${size}"`;

	const episodeMaxSize = window.localStorage.getItem('episodeMaxSize') || defaultEpisodeSize;
	const isEpisodeSize = (size: string) =>
		episodeMaxSize === size ? `value="${size}" selected` : `value="${size}"`;

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

            <label for="dmm-movie-max-size">Biggest movie size to show:</label>
            <select id="dmm-movie-max-size" class="swal2-input">
				<option ${isMovieSize('1')}>1 GB</option>
				<option ${isMovieSize('3')}>3 GB</option>
				<option ${isMovieSize('5')}>5 GB</option>
				<option ${isMovieSize('15')}>15 GB</option>
				<option ${isMovieSize('30')}>30 GB</option>
				<option ${isMovieSize('60')}>60 GB</option>
				<option ${isMovieSize('0')}>Biggest available</option>
			</select>

			<div name="divider" class="py-2"></div>

            <label for="dmm-episode-max-size">Biggest episode size to show:</label>
            <select id="dmm-episode-max-size" class="swal2-input">
                <option ${isEpisodeSize('0.1')}>100 MB</option>
				<option ${isEpisodeSize('0.3')}>300 MB</option>
				<option ${isEpisodeSize('0.5')}>500 MB</option>
				<option ${isEpisodeSize('1')}>1 GB</option>
				<option ${isEpisodeSize('3')}>3 GB</option>
				<option ${isEpisodeSize('5')}>5 GB</option>
				<option ${isEpisodeSize('0')}>Biggest available</option>
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
				movieMaxSize: (document.getElementById('dmm-movie-max-size') as HTMLInputElement)
					.value,
				episodeMaxSize: (
					document.getElementById('dmm-episode-max-size') as HTMLInputElement
				).value,
			};
		},
	});

	if (formValues) {
		window.localStorage.setItem('player', formValues.player);
		window.localStorage.setItem('movieMaxSize', formValues.movieMaxSize);
		window.localStorage.setItem('episodeMaxSize', formValues.episodeMaxSize);
	}
};
