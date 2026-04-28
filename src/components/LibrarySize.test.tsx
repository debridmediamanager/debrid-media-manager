import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LibrarySize from './LibrarySize';

const ONE_GB = 1024 * 1024 * 1024;
const ONE_TB = ONE_GB * 1024;

describe('LibrarySize', () => {
	it('renders torrent count', () => {
		render(<LibrarySize torrentCount={42} totalBytes={ONE_TB} isLoading={false} />);
		expect(screen.getByText(/42 torrents/)).toBeInTheDocument();
	});

	it('renders size in TB', () => {
		render(<LibrarySize torrentCount={10} totalBytes={ONE_TB * 2.5} isLoading={false} />);
		expect(screen.getByText('2.5 TB')).toBeInTheDocument();
	});

	it('shows loading emoji when isLoading is true', () => {
		render(<LibrarySize torrentCount={5} totalBytes={ONE_TB} isLoading={true} />);
		expect(screen.getByText(/5 torrents/)).toHaveTextContent(/\u{1F4AD}/u);
	});

	it('shows small library emoji for < 1 TB', () => {
		render(<LibrarySize torrentCount={3} totalBytes={ONE_GB * 500} isLoading={false} />);
		expect(screen.getByText(/3 torrents/)).toHaveTextContent(/\u{1F641}/u);
	});

	it('shows neutral emoji for 1-10 TB', () => {
		render(<LibrarySize torrentCount={10} totalBytes={ONE_TB * 5} isLoading={false} />);
		expect(screen.getByText(/10 torrents/)).toHaveTextContent(/\u{1F610}/u);
	});

	it('shows slight smile emoji for 10-100 TB', () => {
		render(<LibrarySize torrentCount={50} totalBytes={ONE_TB * 50} isLoading={false} />);
		expect(screen.getByText(/50 torrents/)).toHaveTextContent(/\u{1F642}/u);
	});

	it('shows surprised emoji for 100-1000 TB', () => {
		render(<LibrarySize torrentCount={200} totalBytes={ONE_TB * 500} isLoading={false} />);
		expect(screen.getByText(/200 torrents/)).toHaveTextContent(/\u{1F62E}/u);
	});

	it('shows fearful emoji for 1000-10000 TB', () => {
		render(<LibrarySize torrentCount={500} totalBytes={ONE_TB * 5000} isLoading={false} />);
		expect(screen.getByText(/500 torrents/)).toHaveTextContent(/\u{1F628}/u);
	});

	it('shows screaming emoji for > 10000 TB', () => {
		render(<LibrarySize torrentCount={1000} totalBytes={ONE_TB * 15000} isLoading={false} />);
		expect(screen.getByText(/1000 torrents/)).toHaveTextContent(/\u{1F631}/u);
	});

	it('renders 0 torrents with 0 bytes', () => {
		render(<LibrarySize torrentCount={0} totalBytes={0} isLoading={false} />);
		expect(screen.getByText(/0 torrents/)).toBeInTheDocument();
		expect(screen.getByText('0.0 TB')).toBeInTheDocument();
	});
});
