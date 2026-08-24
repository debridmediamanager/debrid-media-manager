import { describe, expect, it, vi } from 'vitest';
import { renderWatchTab } from './watchTab';

const fakeTab = () => {
	const writes: string[] = [];
	return {
		document: {
			open: vi.fn(),
			write: (html: string) => writes.push(html),
			close: vi.fn(),
		} as any,
		shown: () => writes[writes.length - 1] ?? '',
		renders: () => writes.length,
	};
};

describe('renderWatchTab', () => {
	it('gives the intent a real link to be tapped', () => {
		const tab = fakeTab();

		renderWatchTab(tab, {
			status: 'ready',
			label: 'Real-Debrid',
			intent: 'intent://cdn.example.com/movie.mkv#Intent;package=org.videolan.vlc;end',
		});

		expect(tab.shown()).toContain(
			'href="intent://cdn.example.com/movie.mkv#Intent;package=org.videolan.vlc;end"'
		);
	});

	// TV boxes are driven by a D-pad, so the control has to be where OK lands.
	it('autofocuses the Play link', () => {
		const tab = fakeTab();

		renderWatchTab(tab, { status: 'ready', label: 'TorBox', intent: 'vlc://stream' });

		expect(tab.shown()).toMatch(/<a class="play"[^>]*autofocus/);
	});

	// A TorBox link carries the account's API key in its query string, and `&`
	// unescaped in an href truncates the URL at the first parameter.
	it('escapes the intent into the href', () => {
		const tab = fakeTab();

		renderWatchTab(tab, {
			status: 'ready',
			label: 'TorBox',
			intent: 'intent://n.tb-cdn.st/dld/x?token=k&i=1#Intent;end',
		});

		expect(tab.shown()).toContain(
			'href="intent://n.tb-cdn.st/dld/x?token=k&amp;i=1#Intent;end"'
		);
	});

	it('names the service while the stream is still resolving', () => {
		const tab = fakeTab();

		renderWatchTab(tab, { status: 'resolving', label: 'Premiumize' });

		expect(tab.shown()).toContain('Premiumize');
		expect(tab.shown()).not.toContain('class="play"');
	});

	it('shows a failure in the tab', () => {
		const tab = fakeTab();

		renderWatchTab(tab, {
			status: 'error',
			label: 'AllDebrid',
			message: 'No video files in magnet',
		});

		expect(tab.shown()).toContain('No video files in magnet');
	});

	it('escapes a failure message rather than writing it as markup', () => {
		const tab = fakeTab();

		renderWatchTab(tab, {
			status: 'error',
			label: 'Real-Debrid',
			message: '<img src=x onerror=alert(1)>',
		});

		expect(tab.shown()).not.toContain('<img');
		expect(tab.shown()).toContain('&lt;img');
	});

	it('replaces what the tab was showing instead of appending to it', () => {
		const tab = fakeTab();

		renderWatchTab(tab, { status: 'resolving', label: 'Real-Debrid' });
		renderWatchTab(tab, { status: 'ready', label: 'Real-Debrid', intent: 'vlc://stream' });

		expect(tab.document.open).toHaveBeenCalledTimes(2);
		expect(tab.renders()).toBe(2);
	});

	it('does nothing when the popup was blocked', () => {
		expect(() => renderWatchTab(null, { status: 'resolving', label: 'TorBox' })).not.toThrow();
	});

	it('swallows a closed tab', () => {
		const closed = {
			get document(): Document {
				throw new Error('window is closed');
			},
		};

		expect(() =>
			renderWatchTab(closed, { status: 'ready', label: 'TorBox', intent: 'vlc://s' })
		).not.toThrow();
	});
});
