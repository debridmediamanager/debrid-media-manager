import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgePageCache } from './pageCacheBridge';

const setup = () => {
	const handlers: Record<string, (url: string, opts: { shallow: boolean }) => void> = {};
	const events = {
		on: vi.fn((e: string, h: any) => (handlers[e] = h)),
		off: vi.fn(),
	};
	const postMessage = vi.fn();
	const worker = {
		controller: { postMessage },
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	} as unknown as ServiceWorkerContainer;
	const stop = bridgePageCache(events, worker);
	return { route: handlers.routeChangeComplete, postMessage, stop };
};

afterEach(() => vi.restoreAllMocks());

describe('bridgePageCache', () => {
	// The load itself went through the worker; asking again fetched every page twice.
	it('does not refetch the page it was installed on', () => {
		const { postMessage } = setup();
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('caches a completed route', () => {
		const { route, postMessage } = setup();
		route('/library', { shallow: false });
		expect(postMessage).toHaveBeenCalledWith({
			type: 'CACHE_APP_DOCUMENT',
			url: `${window.location.origin}/library`,
		});
	});

	// Library paging and filters are shallow and load no new document.
	it('skips shallow route changes', () => {
		const { route, postMessage } = setup();
		route('/library?page=2', { shallow: true });
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('never asks for an API URL', () => {
		const { route, postMessage } = setup();
		route('/api/torznab/rd?apikey=x', { shallow: false });
		expect(postMessage).not.toHaveBeenCalled();
	});
});
