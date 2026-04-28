import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/allDebridCastApiClient', () => ({
	updateAllDebridSizeLimits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/torboxCastApiClient', () => ({
	updateTorBoxSizeLimits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/browserStorage', () => ({
	getLocalStorageItemOrDefault: vi.fn((_key: string, fallback: string) => fallback),
	getLocalStorageBoolean: vi.fn((_key: string, fallback: boolean) => fallback),
}));

vi.mock('../utils/settings', () => ({
	defaultMovieSize: '0',
	defaultEpisodeSize: '0',
	defaultOtherStreamsLimit: '5',
}));

import { updateAllDebridSizeLimits } from '../utils/allDebridCastApiClient';
import { updateTorBoxSizeLimits } from '../utils/torboxCastApiClient';
import { CastSettingsPanel } from './CastSettingsPanel';

const mockLocalStorage: Record<string, string> = {};

describe('CastSettingsPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
			(key: string) => mockLocalStorage[key] ?? null
		);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
			mockLocalStorage[key] = value;
		});
		global.fetch = vi.fn().mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders the settings panel with title and icon', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		expect(screen.getByText('Cast Settings')).toBeInTheDocument();
	});

	it('renders all form controls', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		expect(screen.getByText('Biggest movie size')).toBeInTheDocument();
		expect(screen.getByText('Biggest episode size')).toBeInTheDocument();
		expect(screen.getByText('Other streams limit')).toBeInTheDocument();
		expect(screen.getByText(/Hide.*Cast a file inside a torrent.*option/)).toBeInTheDocument();
	});

	it('updates movie size and saves to localStorage', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const selects = screen.getAllByRole('combobox');
		const movieSelect = selects[0];
		fireEvent.change(movieSelect, { target: { value: '15' } });
		expect(mockLocalStorage['settings:movieMaxSize']).toBe('15');
	});

	it('updates episode size and saves to localStorage', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const selects = screen.getAllByRole('combobox');
		const episodeSelect = selects[1];
		fireEvent.change(episodeSelect, { target: { value: '3' } });
		expect(mockLocalStorage['settings:episodeMaxSize']).toBe('3');
	});

	it('updates other streams limit and saves to localStorage', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const selects = screen.getAllByRole('combobox');
		const streamsSelect = selects[2];
		fireEvent.change(streamsSelect, { target: { value: '2' } });
		expect(mockLocalStorage['settings:otherStreamsLimit']).toBe('2');
	});

	it('updates hide cast option and saves to localStorage', () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const checkbox = screen.getByRole('checkbox');
		fireEvent.click(checkbox);
		expect(mockLocalStorage['settings:hideCastOption']).toBe('true');
	});

	it('calls fetch API for rd service when castToken is present', async () => {
		mockLocalStorage['rd:castToken'] = 'test-token';
		mockLocalStorage['rd:clientId'] = '"test-client-id"';
		mockLocalStorage['rd:clientSecret'] = '"test-client-secret"';
		mockLocalStorage['rd:refreshToken'] = '"test-refresh-token"';

		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '30' } });

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				'/api/stremio/cast/updateSizeLimits',
				expect.objectContaining({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
				})
			);
		});
	});

	it('calls updateTorBoxSizeLimits for tb service', async () => {
		mockLocalStorage['tb:apiKey'] = 'tb-key';

		render(<CastSettingsPanel service="tb" accentColor="purple" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '5' } });

		await waitFor(() => {
			expect(updateTorBoxSizeLimits).toHaveBeenCalledWith(
				'tb-key',
				5,
				undefined,
				undefined,
				undefined
			);
		});
	});

	it('calls updateAllDebridSizeLimits for ad service', async () => {
		mockLocalStorage['ad:apiKey'] = 'ad-key';

		render(<CastSettingsPanel service="ad" accentColor="yellow" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '3' } });

		await waitFor(() => {
			expect(updateAllDebridSizeLimits).toHaveBeenCalledWith(
				'ad-key',
				3,
				undefined,
				undefined,
				undefined
			);
		});
	});

	it('applies correct color classes for each accent color', () => {
		const { rerender } = render(<CastSettingsPanel service="rd" accentColor="green" />);
		expect(screen.getByText('Cast Settings').className).toContain('green');

		rerender(<CastSettingsPanel service="ad" accentColor="yellow" />);
		expect(screen.getByText('Cast Settings').className).toContain('yellow');

		rerender(<CastSettingsPanel service="tb" accentColor="purple" />);
		expect(screen.getByText('Cast Settings').className).toContain('purple');
	});

	it('does not call server update when no credentials are present for rd', async () => {
		render(<CastSettingsPanel service="rd" accentColor="green" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '15' } });

		await new Promise((r) => setTimeout(r, 50));
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('does not call server update when no api key for tb', async () => {
		render(<CastSettingsPanel service="tb" accentColor="purple" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '15' } });

		await new Promise((r) => setTimeout(r, 50));
		expect(updateTorBoxSizeLimits).not.toHaveBeenCalled();
	});

	it('does not call server update when no api key for ad', async () => {
		render(<CastSettingsPanel service="ad" accentColor="yellow" />);
		const selects = screen.getAllByRole('combobox');
		fireEvent.change(selects[0], { target: { value: '15' } });

		await new Promise((r) => setTimeout(r, 50));
		expect(updateAllDebridSizeLimits).not.toHaveBeenCalled();
	});
});
