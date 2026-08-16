import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openWatch: vi.fn() }));

vi.mock('@/utils/watchService', () => ({ openWatch: mocks.openWatch }));

import { bindWatchButtons } from './watchButtons';

const row = (attrs: Record<string, string>) => {
	const button = document.createElement('button');
	button.textContent = 'Watch';
	Object.entries(attrs).forEach(([name, value]) => button.setAttribute(name, value));
	document.body.appendChild(button);
	return button;
};

const bind = (over: Partial<Parameters<typeof bindWatchButtons>[0]> = {}) =>
	bindWatchButtons({
		service: 'rd',
		hash: 'hash-1',
		player: 'windows/vlc',
		keys: { rdKey: 'rd-key' },
		...over,
	});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.openWatch.mockResolvedValue(undefined);
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('bindWatchButtons', () => {
	it('hands the modal service and the row details to openWatch', async () => {
		const button = row({
			'data-watch': '1',
			'data-watch-file-name': 'Episode.mkv',
			'data-watch-file-id': '4',
		});
		bind();

		button.click();
		await vi.waitFor(() => expect(mocks.openWatch).toHaveBeenCalledTimes(1));

		expect(mocks.openWatch).toHaveBeenCalledWith({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'hash-1',
			keys: { rdKey: 'rd-key' },
			link: undefined,
			fileName: 'Episode.mkv',
			fileId: '4',
			adInLibrary: undefined,
		});
	});

	it('passes a row link through so the hash is not re-added', async () => {
		const button = row({
			'data-watch': '1',
			'data-watch-link': 'https://real-debrid.com/d/XYZ',
		});
		bind();

		button.click();
		await vi.waitFor(() => expect(mocks.openWatch).toHaveBeenCalledTimes(1));

		expect(mocks.openWatch.mock.calls[0][0].link).toBe('https://real-debrid.com/d/XYZ');
	});

	it('carries the AllDebrid library flag so a saved magnet is not deleted', async () => {
		const button = row({ 'data-watch': '1' });
		bind({ service: 'ad', keys: { adKey: 'ad-key' }, adInLibrary: true });

		button.click();
		await vi.waitFor(() => expect(mocks.openWatch).toHaveBeenCalledTimes(1));

		expect(mocks.openWatch.mock.calls[0][0].adInLibrary).toBe(true);
	});

	// The form submissions these replaced gave no feedback at all - a slow RD
	// resolve looked like a dead button.
	it('shows a spinner while resolving and restores the label after', async () => {
		let release: () => void = () => {};
		mocks.openWatch.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		const button = row({ 'data-watch': '1' });
		bind();

		button.click();
		await vi.waitFor(() => expect(button.disabled).toBe(true));
		expect(button.innerHTML).toContain('animate-spin');

		release();
		await vi.waitFor(() => expect(button.disabled).toBe(false));
		expect(button.innerHTML).toBe('Watch');
	});

	it('restores the button when the watch fails', async () => {
		mocks.openWatch.mockRejectedValue(new Error('boom'));
		const button = row({ 'data-watch': '1' });
		bind();

		button.click();
		await vi.waitFor(() => expect(button.disabled).toBe(false));
		expect(button.innerHTML).toBe('Watch');
	});

	it('ignores buttons without the marker', () => {
		const button = row({ 'data-watch-file-name': 'Episode.mkv' });
		bind();

		button.click();

		expect(mocks.openWatch).not.toHaveBeenCalled();
	});

	// Both the RD and the TB modal can be opened over an already-open one, and a
	// double binding would fire two watches from one click.
	it('binds a button only once', async () => {
		const button = row({ 'data-watch': '1' });
		bind();
		bind();

		button.click();
		await vi.waitFor(() => expect(mocks.openWatch).toHaveBeenCalledTimes(1));
	});
});
