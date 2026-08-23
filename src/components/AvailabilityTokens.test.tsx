import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AvailabilityTokens from './AvailabilityTokens';

const onQueryChange = vi.fn();

describe('AvailabilityTokens', () => {
	beforeEach(() => {
		onQueryChange.mockReset();
	});

	it('renders nothing when no debrid service is configured', () => {
		const { container } = render(
			<AvailabilityTokens query="" onQueryChange={onQueryChange} rdKey={null} />
		);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders only the configured services and no "Any" for a single one', () => {
		render(<AvailabilityTokens query="" onQueryChange={onQueryChange} rdKey="rd-key" />);

		expect(screen.getByText('RD ✓')).toBeInTheDocument();
		expect(screen.queryByText('AD ✓')).not.toBeInTheDocument();
		expect(screen.queryByText('TB ✓')).not.toBeInTheDocument();
		expect(screen.queryByText('PM ✓')).not.toBeInTheDocument();
		expect(screen.queryByText('Any ✓')).not.toBeInTheDocument();
	});

	it('adds an "Any" token once more than one service is configured', () => {
		render(
			<AvailabilityTokens
				query=""
				onQueryChange={onQueryChange}
				rdKey="rd-key"
				adKey="ad-key"
				torboxKey="tb-key"
			/>
		);

		fireEvent.click(screen.getByText('TB ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('is:tb');

		fireEvent.click(screen.getByText('Any ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('is:cached');
	});

	it('appends to the current query and toggles the active token off', () => {
		const { rerender } = render(
			<AvailabilityTokens query="1080p" onQueryChange={onQueryChange} rdKey="rd-key" />
		);

		fireEvent.click(screen.getByText('RD ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('1080p is:rd');

		rerender(
			<AvailabilityTokens query="1080p is:rd" onQueryChange={onQueryChange} rdKey="rd-key" />
		);
		expect(screen.getByText('RD ✓')).toHaveAttribute('aria-pressed', 'true');

		fireEvent.click(screen.getByText('RD ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('1080p');
	});

	it('colours each pill with its service colour', () => {
		render(
			<AvailabilityTokens
				query="is:rd"
				onQueryChange={onQueryChange}
				rdKey="rd-key"
				adKey="ad-key"
				torboxKey="tb-key"
			/>
		);

		// RD green, AD amber, TB indigo, PM dark red - same coding as the badges
		expect(screen.getByText('RD ✓').className).toContain('bg-[#b5d496]');
		expect(screen.getByText('AD ✓').className).toContain('[#fbc730]');
		expect(screen.getByText('TB ✓').className).toContain('[#4f46e5]');
		expect(screen.getByText('Any ✓').className).toContain('gray');
	});

	it('replaces an active token when another service is picked', () => {
		render(
			<AvailabilityTokens
				query="1080p is:rd"
				onQueryChange={onQueryChange}
				rdKey="rd-key"
				adKey="ad-key"
			/>
		);

		fireEvent.click(screen.getByText('AD ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('1080p is:ad');
	});

	it('offers a Premiumize pill only once a Premiumize key exists', () => {
		const { rerender } = render(
			<AvailabilityTokens query="" onQueryChange={onQueryChange} rdKey="rd-key" />
		);
		expect(screen.queryByText('PM ✓')).not.toBeInTheDocument();

		rerender(
			<AvailabilityTokens
				query=""
				onQueryChange={onQueryChange}
				rdKey="rd-key"
				premiumizeKey="pm-key"
			/>
		);

		fireEvent.click(screen.getByText('PM ✓'));
		expect(onQueryChange).toHaveBeenCalledWith('is:pm');
		expect(screen.getByText('PM ✓').className).toContain('[#aa0000]');
	});

	it('shows only Premiumize for a Premiumize-only user, with no "Any"', () => {
		render(
			<AvailabilityTokens query="" onQueryChange={onQueryChange} premiumizeKey="pm-key" />
		);

		expect(screen.getByText('PM ✓')).toBeInTheDocument();
		expect(screen.queryByText('Any ✓')).not.toBeInTheDocument();
	});
});
