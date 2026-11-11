import ResultsTabs from '@/components/ResultsTabs';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { opensOnUsenet } from './resultsTab';

// Easynews or a DMM key alone gives nothing to do with a torrent result, so a
// browser without a debrid account sees only the Usenet tab.
describe('results tabs without a debrid account', () => {
	beforeEach(() => localStorage.clear());

	it('opens on Usenet, even when the Torrents tab is asked for', () => {
		localStorage.setItem('en:account', '{"username":"u","password":"p"}');
		expect(opensOnUsenet({})).toBe(true);
		expect(opensOnUsenet({ tab: 'torrents' })).toBe(true);

		render(<ResultsTabs basePath="/movie/tt0111161" active="usenet" />);
		expect(screen.queryByText('Torrents')).not.toBeInTheDocument();
		expect(screen.getByText('Usenet')).toBeInTheDocument();
	});

	it('keeps the Torrents tab for a debrid account', () => {
		localStorage.setItem('rd:refreshToken', 'r');
		expect(opensOnUsenet({})).toBe(false);

		render(<ResultsTabs basePath="/movie/tt0111161" active="torrents" />);
		expect(screen.getByText('Torrents')).toBeInTheDocument();
	});
});
