import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/allDebridCastApiClient', () => ({
	syncAllDebridCastSettings: vi.fn().mockResolvedValue('cast-token'),
}));

vi.mock('../utils/torboxCastApiClient', () => ({
	updateTorBoxSizeLimits: vi.fn().mockResolvedValue(undefined),
}));

import { syncAllDebridCastSettings } from '../utils/allDebridCastApiClient';
import { updateTorBoxSizeLimits } from '../utils/torboxCastApiClient';
import { SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
	let userAgentSpy: ReturnType<typeof vi.spyOn> | undefined;
	let originalRegister: Navigator['registerProtocolHandler'] | undefined;

	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
	});

	afterEach(() => {
		userAgentSpy?.mockRestore();
		userAgentSpy = undefined;
		if (originalRegister) {
			(
				navigator as Navigator & {
					registerProtocolHandler?: Navigator['registerProtocolHandler'];
				}
			).registerProtocolHandler = originalRegister;
		} else {
			Reflect.deleteProperty(
				navigator as Navigator & { registerProtocolHandler?: unknown },
				'registerProtocolHandler'
			);
		}
		originalRegister = undefined;
	});

	// The default only makes sense for someone who has nothing but Real-Debrid:
	// the filter hides releases RD refuses by name, which every other service
	// serves perfectly well. A Debrid-Link credential is one of those, in either
	// of the two shapes it can take.
	describe('the hide-RD-blocked default', () => {
		const checkbox = () =>
			document.getElementById('dmm-hide-rd-blocked-torrents') as HTMLInputElement;

		it('defaults on for a Real-Debrid-only user', () => {
			localStorage.setItem('rd:accessToken', JSON.stringify('rd-token'));
			render(<SettingsSection />);
			expect(checkbox().checked).toBe(true);
		});

		it('defaults off when the user also holds a Debrid-Link OAuth token', () => {
			localStorage.setItem('rd:accessToken', JSON.stringify('rd-token'));
			localStorage.setItem('dl:accessToken', JSON.stringify('dl-token'));
			render(<SettingsSection />);
			expect(checkbox().checked).toBe(false);
		});

		it('defaults off when the user also holds a pasted Debrid-Link token', () => {
			localStorage.setItem('rd:accessToken', JSON.stringify('rd-token'));
			localStorage.setItem('dl:apiKey', JSON.stringify('dl-api-token'));
			render(<SettingsSection />);
			expect(checkbox().checked).toBe(false);
		});
	});

	it('loads persisted preferences and updates each toggle', async () => {
		localStorage.setItem('settings:player', 'ios/infuse');
		localStorage.setItem('settings:movieMaxSize', '15');
		localStorage.setItem('settings:episodeMaxSize', '5');
		localStorage.setItem('settings:onlyTrustedTorrents', 'true');
		localStorage.setItem('settings:defaultTorrentsFilter', 'hdr');
		localStorage.setItem('settings:downloadMagnets', 'true');
		localStorage.setItem('settings:showMassReportButtons', 'true');
		localStorage.setItem('settings:availabilityCheckLimit', '5');
		localStorage.setItem('settings:includeTrackerStats', 'true');
		localStorage.setItem('settings:enableTorrentio', 'false');
		localStorage.setItem('settings:enableComet', 'true');
		localStorage.setItem('settings:enableMediaFusion', 'false');
		localStorage.setItem('settings:enablePeerflix', 'true');
		localStorage.setItem('settings:enableTorrentsDB', 'false');

		const { rerender } = render(<SettingsSection />);
		const user = userEvent.setup();

		expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

		const movieSizeContainer = screen.getByText('Biggest movie size').closest('div')!;
		const movieSize = within(movieSizeContainer).getByRole('combobox');
		expect(movieSize).toHaveValue('15');
		await user.selectOptions(movieSize, '5');
		expect(localStorage.getItem('settings:movieMaxSize')).toBe('5');

		const episodeContainer = screen.getByText('Biggest episode size').closest('div')!;
		const episodeSize = within(episodeContainer).getByRole('combobox');
		expect(episodeSize).toHaveValue('5');
		await user.selectOptions(episodeSize, '3');
		expect(localStorage.getItem('settings:episodeMaxSize')).toBe('3');

		const playerContainer = screen.getByText('Video player').closest('div')!;
		const playerSelect = within(playerContainer).getByRole('combobox');
		expect(playerSelect).toHaveValue('ios/infuse');
		await user.selectOptions(playerSelect, 'android/chooser');
		expect(localStorage.getItem('settings:player')).toBe('android/chooser');

		const filterContainer = screen.getByText('Default torrents filter').closest('div')!;
		const filterInput = within(filterContainer).getByRole('textbox');
		expect(filterInput).toHaveValue('hdr');
		await user.clear(filterInput);
		await user.type(filterInput, '1080p');
		expect(localStorage.getItem('settings:defaultTorrentsFilter')).toBe('1080p');

		const trustedContainer = screen.getByText('Only trusted torrents').closest('div')!;
		const trustedCheckbox = within(trustedContainer).getByRole('checkbox');
		expect(trustedCheckbox).toBeChecked();
		await user.click(trustedCheckbox);
		expect(trustedCheckbox).not.toBeChecked();
		expect(localStorage.getItem('settings:onlyTrustedTorrents')).toBe('false');

		const downloadContainer = screen
			.getByText('Download .magnet files instead of copy')
			.closest('div')!;
		const downloadCheckbox = within(downloadContainer).getByRole('checkbox');
		expect(downloadCheckbox).toBeChecked();
		await user.click(downloadCheckbox);
		expect(downloadCheckbox).not.toBeChecked();
		expect(localStorage.getItem('settings:downloadMagnets')).toBe('false');

		const reportContainer = screen.getByText('Show mass report buttons').closest('div')!;
		const reportCheckbox = within(reportContainer).getByRole('checkbox');
		expect(reportCheckbox).toBeChecked();
		await user.click(reportCheckbox);
		expect(reportCheckbox).not.toBeChecked();
		expect(localStorage.getItem('settings:showMassReportButtons')).toBe('false');

		const limitContainer = screen.getByText('Service check limit').closest('div')!;
		const limitInput = within(limitContainer).getByRole('spinbutton');
		expect(limitInput).toHaveValue(5);
		await user.clear(limitInput);
		await user.type(limitInput, '10');
		expect(localStorage.getItem('settings:availabilityCheckLimit')).toBe('10');

		const trackerContainer = screen
			.getByText('Include tracker stats in service check')
			.closest('div')!;
		const trackerCheckbox = within(trackerContainer).getByRole('checkbox');
		expect(trackerCheckbox).toBeChecked();
		await user.click(trackerCheckbox);
		expect(localStorage.getItem('settings:includeTrackerStats')).toBe('false');

		const torrentioContainer = screen.getByText('Enable Torrentio').closest('div')!;
		const torrentioCheckbox = within(torrentioContainer).getByRole('checkbox');
		expect(torrentioCheckbox).not.toBeChecked();
		await user.click(torrentioCheckbox);
		expect(localStorage.getItem('settings:enableTorrentio')).toBe('true');

		const cometContainer = screen.getByText('Enable Comet').closest('div')!;
		const cometCheckbox = within(cometContainer).getByRole('checkbox');
		expect(cometCheckbox).toBeChecked();
		await user.click(cometCheckbox);
		expect(localStorage.getItem('settings:enableComet')).toBe('false');

		const mediaFusionContainer = screen.getByText('Enable MediaFusion').closest('div')!;
		const mediaFusionCheckbox = within(mediaFusionContainer).getByRole('checkbox');
		expect(mediaFusionCheckbox).not.toBeChecked();
		await user.click(mediaFusionCheckbox);
		expect(localStorage.getItem('settings:enableMediaFusion')).toBe('true');

		const peerflixContainer = screen.getByText('Enable Peerflix').closest('div')!;
		const peerflixCheckbox = within(peerflixContainer).getByRole('checkbox');
		expect(peerflixCheckbox).toBeChecked();
		await user.click(peerflixCheckbox);
		expect(localStorage.getItem('settings:enablePeerflix')).toBe('false');

		const torrentsDbContainer = screen.getByText('Enable TorrentsDB').closest('div')!;
		const torrentsDbCheckbox = within(torrentsDbContainer).getByRole('checkbox');
		expect(torrentsDbCheckbox).not.toBeChecked();
		await user.click(torrentsDbCheckbox);
		expect(localStorage.getItem('settings:enableTorrentsDB')).toBe('true');
	});

	it('handles magnet handler registration and browser instructions for different agents', async () => {
		localStorage.setItem('settings:magnetHandlerEnabled', 'false');
		const registerSpy = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('register failed');
			})
			.mockImplementation(() => {});
		originalRegister = (
			navigator as Navigator & {
				registerProtocolHandler?: Navigator['registerProtocolHandler'];
			}
		).registerProtocolHandler;
		(
			navigator as Navigator & { registerProtocolHandler?: typeof registerSpy }
		).registerProtocolHandler = registerSpy;

		userAgentSpy = vi
			.spyOn(window.navigator, 'userAgent', 'get')
			.mockReturnValue('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36');

		const { rerender } = render(<SettingsSection />);
		const user = userEvent.setup();

		const magnetButton = screen.getByRole('button', {
			name: /Make DMM your default magnet handler/i,
		});

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await user.click(magnetButton);
			expect(registerSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				'Error registering protocol handler:',
				expect.any(Error)
			);
			expect(localStorage.getItem('settings:magnetHandlerEnabled')).toBe('false');
			expect(
				screen.getByRole('button', { name: /Make DMM your default magnet handler/i })
			).toBeInTheDocument();

			await user.click(
				screen.getByRole('button', { name: /Make DMM your default magnet handler/i })
			);
			expect(registerSpy).toHaveBeenCalledTimes(2);
			expect(localStorage.getItem('settings:magnetHandlerEnabled')).toBe('true');
			expect(
				screen.getByRole('button', { name: /DMM is your default magnet handler/i })
			).toBeInTheDocument();

			const chromeInstructions = await screen.findByText('Chrome protocol handler settings:');
			expect(chromeInstructions).toBeInTheDocument();
			expect(screen.getByDisplayValue('chrome://settings/handlers')).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /Hide instructions/i })).toBeNull();

			userAgentSpy.mockReturnValue('Mozilla/5.0 Edg/120.0.0.0');
			rerender(<SettingsSection />);
			const edgeInstructions = await screen.findByText('Edge protocol handler settings:');
			expect(edgeInstructions).toBeInTheDocument();
			expect(
				screen.getByDisplayValue('edge://settings/content/handlers')
			).toBeInTheDocument();

			userAgentSpy.mockReturnValue('Mozilla/5.0 Safari/17.0');
			rerender(<SettingsSection />);
			const genericInstructions = await screen.findByText(
				'Browser protocol handler settings:'
			);
			expect(genericInstructions).toBeInTheDocument();
			const instructionsWrapper = genericInstructions.parentElement as HTMLElement;
			expect(within(instructionsWrapper).getByDisplayValue('')).toBeInTheDocument();
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('skips magnet handler registration when the API is unavailable', async () => {
		localStorage.setItem('settings:magnetHandlerEnabled', 'false');
		originalRegister = (
			navigator as Navigator & {
				registerProtocolHandler?: Navigator['registerProtocolHandler'];
			}
		).registerProtocolHandler;
		Reflect.deleteProperty(
			navigator as Navigator & { registerProtocolHandler?: unknown },
			'registerProtocolHandler'
		);

		render(<SettingsSection />);
		const user = userEvent.setup();

		const magnetButton = screen.getByRole('button', {
			name: /Make DMM your default magnet handler/i,
		});

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await user.click(magnetButton);
			expect(localStorage.getItem('settings:magnetHandlerEnabled')).not.toBe('true');
			expect(
				screen.getByRole('button', { name: /Make DMM your default magnet handler/i })
			).toBeInTheDocument();
			expect(errorSpy).not.toHaveBeenCalledWith(
				'Error registering protocol handler:',
				expect.any(Error)
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('updates TorBox cast profile using decoded api key from /settings', async () => {
		localStorage.setItem('tb:apiKey', JSON.stringify('tb-key'));

		render(<SettingsSection />);
		const user = userEvent.setup();

		const otherStreamsContainer = screen.getByText('Other streams limit').closest('div')!;
		const otherStreamsSelect = within(otherStreamsContainer).getByRole('combobox');
		await user.selectOptions(otherStreamsSelect, '0');

		expect(updateTorBoxSizeLimits).toHaveBeenCalledWith(
			'tb-key',
			undefined,
			undefined,
			0,
			undefined
		);
	});

	it('updates AllDebrid cast profile via the cast token from /settings', async () => {
		localStorage.setItem('ad:apiKey', JSON.stringify('ad-key'));
		localStorage.setItem('ad:castToken', JSON.stringify('cast-token'));

		render(<SettingsSection />);
		const user = userEvent.setup();

		const hideCastContainer = screen
			.getByText('Hide "Cast a file inside a torrent" option')
			.closest('div')!;
		const hideCastCheckbox = within(hideCastContainer).getByRole('checkbox');
		await user.click(hideCastCheckbox);

		expect(syncAllDebridCastSettings).toHaveBeenCalledWith('cast-token', 'ad-key', {
			movieMaxSize: undefined,
			episodeMaxSize: undefined,
			otherStreamsLimit: undefined,
			hideCastOption: true,
		});
	});

	// Real-Debrid is the only provider this section reaches with a raw fetch
	// rather than a cast API client, and it was the only one omitting the sponsor
	// token. The server then validated the raised limit against the non-sponsor
	// ceiling of 5 and rejected it, so the dropdown offered a sponsor a value
	// that could never save.
	it('sends the sponsor token with the Real-Debrid cast settings update', async () => {
		const claims = {
			shortId: 'ZP1M',
			githubUsername: 'someone',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() + 3_600_000,
		};
		const token = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
		localStorage.setItem('dmm:sponsorToken', JSON.stringify(token));
		localStorage.setItem('rd:castToken', 'cast-token');
		localStorage.setItem('rd:clientId', JSON.stringify('client-id'));
		localStorage.setItem('rd:clientSecret', JSON.stringify('client-secret'));

		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal('fetch', fetchMock);

		try {
			render(<SettingsSection />);
			const user = userEvent.setup();

			const limitContainer = screen.getByText('Other streams limit').closest('div')!;
			const limitSelect = within(limitContainer).getByRole('combobox');
			// 10 is the sponsor-only ceiling, so it is only in the list at all
			// because the badge decoded; saving it is what the header unlocks.
			expect(within(limitSelect).getByRole('option', { name: '10 streams' })).toBeVisible();
			await user.selectOptions(limitSelect, '10');

			expect(fetchMock).toHaveBeenCalledWith(
				'/api/stremio/cast/updateSizeLimits',
				expect.objectContaining({
					headers: expect.objectContaining({ 'x-dmm-sponsor': token }),
				})
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('leaves AllDebrid alone when the member never enrolled in cast', async () => {
		localStorage.setItem('ad:apiKey', JSON.stringify('ad-key'));

		render(<SettingsSection />);
		const user = userEvent.setup();

		const hideCastContainer = screen
			.getByText('Hide "Cast a file inside a torrent" option')
			.closest('div')!;
		const hideCastCheckbox = within(hideCastContainer).getByRole('checkbox');
		await user.click(hideCastCheckbox);

		expect(syncAllDebridCastSettings).not.toHaveBeenCalled();
	});
});
