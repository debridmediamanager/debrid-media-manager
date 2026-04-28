import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TraktSection } from './TraktSection';

vi.mock('next/link', () => ({
	default: ({ children, href, ...props }: any) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

import { vi } from 'vitest';

describe('TraktSection', () => {
	it('renders Movies, Shows, and Calendar links without user', () => {
		render(<TraktSection traktUser={null} />);
		expect(screen.getByText('Movies')).toBeInTheDocument();
		expect(screen.getByText('Shows')).toBeInTheDocument();
		expect(screen.getByText('Calendar')).toBeInTheDocument();
	});

	it('links to correct paths', () => {
		render(<TraktSection traktUser={null} />);
		expect(screen.getByText('Movies').closest('a')).toHaveAttribute('href', '/trakt/movies');
		expect(screen.getByText('Shows').closest('a')).toHaveAttribute('href', '/trakt/shows');
		expect(screen.getByText('Calendar').closest('a')).toHaveAttribute('href', '/calendar');
	});

	it('does not render user-only links when traktUser is null', () => {
		render(<TraktSection traktUser={null} />);
		expect(screen.queryByText('Watchlist')).not.toBeInTheDocument();
		expect(screen.queryByText('Collections')).not.toBeInTheDocument();
		expect(screen.queryByText('My lists')).not.toBeInTheDocument();
	});

	it('renders user-only links when traktUser is provided', () => {
		const user = { username: 'testuser' } as any;
		render(<TraktSection traktUser={user} />);
		expect(screen.getByText('Watchlist')).toBeInTheDocument();
		expect(screen.getByText('Collections')).toBeInTheDocument();
		expect(screen.getByText('My lists')).toBeInTheDocument();
	});

	it('links user sections to correct paths', () => {
		const user = { username: 'testuser' } as any;
		render(<TraktSection traktUser={user} />);
		expect(screen.getByText('Watchlist').closest('a')).toHaveAttribute(
			'href',
			'/trakt/watchlist'
		);
		expect(screen.getByText('Collections').closest('a')).toHaveAttribute(
			'href',
			'/trakt/collection'
		);
		expect(screen.getByText('My lists').closest('a')).toHaveAttribute('href', '/trakt/mylists');
	});

	it('still renders base links when traktUser is provided', () => {
		const user = { username: 'testuser' } as any;
		render(<TraktSection traktUser={user} />);
		expect(screen.getByText('Movies')).toBeInTheDocument();
		expect(screen.getByText('Shows')).toBeInTheDocument();
		expect(screen.getByText('Calendar')).toBeInTheDocument();
	});
});
