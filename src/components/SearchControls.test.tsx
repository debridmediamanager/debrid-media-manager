import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const onQueryChange = vi.fn();
const onMassReport = vi.fn();

vi.mock('@/components/SearchTokens', () => ({
	__esModule: true,
	default: ({ onTokenClick }: { onTokenClick: (token: string) => void }) => (
		<button data-testid="token-button" onClick={() => onTokenClick('1080p')}>
			Token
		</button>
	),
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	RotateCcw: () => <span data-testid="rotate-icon" />,
	Search: () => <span data-testid="search-icon" />,
}));

import SearchControls from './SearchControls';

const defaultProps = {
	query: '',
	onQueryChange,
	filteredCount: 0,
	totalCount: 0,
	showMassReportButtons: false,
	rdKey: null,
	onMassReport,
	mediaType: 'movie' as const,
	title: 'Demo Title',
	year: '1999',
	isShow: false,
};

describe('SearchControls', () => {
	beforeEach(() => {
		onQueryChange.mockReset();
		onMassReport.mockReset();
	});

	it('updates query input with lowercase text and supports reset', () => {
		render(<SearchControls {...defaultProps} />);
		const input = screen.getByPlaceholderText(/filter results/i);
		fireEvent.change(input, { target: { value: 'HDR' } });
		expect(onQueryChange).toHaveBeenCalledWith('hdr');

		fireEvent.click(screen.getByTitle(/Reset search/i));
		expect(onQueryChange).toHaveBeenCalledWith('');
	});

	it('shows mass report buttons only when query, rd key, and flags are present', () => {
		render(
			<SearchControls
				{...defaultProps}
				query="matrix"
				totalCount={3}
				showMassReportButtons
				rdKey="abc"
				mediaType="tv"
			/>
		);

		fireEvent.click(screen.getByText(/Report as Porn/i));
		expect(onMassReport).toHaveBeenCalledWith('porn');

		fireEvent.click(screen.getByText(/Report Wrong IMDB/i));
		expect(onMassReport).toHaveBeenCalledWith('wrong_imdb');

		fireEvent.click(screen.getByText(/Report Wrong Season/i));
		expect(onMassReport).toHaveBeenCalledWith('wrong_season');
	});

	it('appends search tokens and color scale queries', () => {
		render(
			<SearchControls
				{...defaultProps}
				query="source:hdr"
				colorScales={[{ threshold: 5, color: 'red-500', label: 'High quality' }]}
				getQueryForScale={(threshold: number) => `videos:${threshold}`}
			/>
		);

		fireEvent.click(screen.getByTestId('token-button'));
		expect(onQueryChange).toHaveBeenCalledWith('source:hdr 1080p');

		fireEvent.click(screen.getByText(/High quality/i));
		expect(onQueryChange).toHaveBeenCalledWith('source:hdr videos:5');
	});
});
