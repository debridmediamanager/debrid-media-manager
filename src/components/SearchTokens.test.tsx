import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SearchTokens from './SearchTokens';

describe('SearchTokens', () => {
	it('renders tokens from title words and year', () => {
		const onTokenClick = vi.fn();
		render(<SearchTokens title="Breaking Bad" year="2008" onTokenClick={onTokenClick} />);

		expect(screen.getByText('breaking')).toBeInTheDocument();
		expect(screen.getByText('bad')).toBeInTheDocument();
		expect(screen.getByText('2008')).toBeInTheDocument();
	});

	// SearchControls puts this group in a non-wrapping, horizontally scrolling
	// chip row. At 390px the group shrank to its widest word and stacked
	// "the / shawshank / redemption / 1994" one per line; it must keep its
	// one-line width and let the row scroll.
	it('keeps its tokens on one line inside the scrolling chip row', () => {
		render(
			<SearchTokens title="The Shawshank Redemption" year="1994" onTokenClick={vi.fn()} />
		);

		expect(screen.getByText('shawshank').parentElement).toHaveClass('shrink-0');
	});

	it('formats year as season number for shows', () => {
		const onTokenClick = vi.fn();
		render(
			<SearchTokens
				title="Game of Thrones"
				year="1"
				isShow={true}
				onTokenClick={onTokenClick}
			/>
		);

		expect(screen.getByText('s01')).toBeInTheDocument();
	});

	it('handles multi-digit season numbers', () => {
		const onTokenClick = vi.fn();
		render(
			<SearchTokens
				title="The Simpsons"
				year="12"
				isShow={true}
				onTokenClick={onTokenClick}
			/>
		);

		expect(screen.getByText('s12')).toBeInTheDocument();
	});

	it('calls onTokenClick with regex-ready filter value', async () => {
		const onTokenClick = vi.fn();
		const user = userEvent.setup();
		render(<SearchTokens title="The Matrix" year="1999" onTokenClick={onTokenClick} />);

		await user.click(screen.getByText('matrix'));

		expect(onTokenClick).toHaveBeenCalledWith('matrix');
	});

	it('removes duplicate tokens', () => {
		const onTokenClick = vi.fn();
		render(<SearchTokens title="The The Movie" year="2020" onTokenClick={onTokenClick} />);

		const theTokens = screen.getAllByText('the');
		expect(theTokens).toHaveLength(1);
	});

	it('filters out empty strings from title', () => {
		const onTokenClick = vi.fn();
		const { container } = render(
			<SearchTokens title="  Multiple   Spaces  " year="2021" onTokenClick={onTokenClick} />
		);

		const tokens = container.querySelectorAll('span');
		expect(tokens.length).toBe(3); // multiple, spaces, 2021
	});

	it('converts title to lowercase', () => {
		const onTokenClick = vi.fn();
		render(<SearchTokens title="UPPERCASE TITLE" year="2022" onTokenClick={onTokenClick} />);

		expect(screen.getByText('uppercase')).toBeInTheDocument();
		expect(screen.getByText('title')).toBeInTheDocument();
	});

	it('strips colons from title tokens', () => {
		const onTokenClick = vi.fn();
		render(
			<SearchTokens title="Spider-Man: No Way Home" year="2021" onTokenClick={onTokenClick} />
		);

		expect(screen.getByText('spider-man')).toBeInTheDocument();
		expect(screen.getByText('no')).toBeInTheDocument();
		expect(screen.queryByText('spider-man:')).not.toBeInTheDocument();
	});

	it('emits filter value with symbols made optional', async () => {
		const onTokenClick = vi.fn();
		const user = userEvent.setup();
		render(
			<SearchTokens title="Spider-Man: No Way Home" year="2021" onTokenClick={onTokenClick} />
		);

		await user.click(screen.getByText('spider-man'));

		// The hyphen should become optional: spider-?man
		expect(onTokenClick).toHaveBeenCalledWith('spider-?man');
	});

	it('leaves alphanumeric-only tokens unchanged in filter', async () => {
		const onTokenClick = vi.fn();
		const user = userEvent.setup();
		render(<SearchTokens title="Matrix" year="1999" onTokenClick={onTokenClick} />);

		await user.click(screen.getByText('matrix'));

		expect(onTokenClick).toHaveBeenCalledWith('matrix');
	});

	it('applies correct CSS classes for styling', () => {
		const onTokenClick = vi.fn();
		const { container } = render(
			<SearchTokens title="Test" year="2023" onTokenClick={onTokenClick} />
		);

		const token = container.querySelector('span');
		expect(token).toHaveClass('cursor-pointer', 'whitespace-nowrap', 'rounded', 'border');
	});
});
