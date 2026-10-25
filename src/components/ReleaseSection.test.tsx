import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReleaseSection, type ReleaseRow } from './ReleaseSection';

const ROWS: ReleaseRow[] = [
	{ title: 'Bravo.Release.1080p', size: 3 * 1024 ** 3 },
	{ title: 'Alpha.Release.2160p', size: 9 * 1024 ** 3, isPack: true },
];

function Section({ heading, collapsedKey }: { heading: string; collapsedKey: string }) {
	return (
		<ReleaseSection
			heading={heading}
			collapsedKey={collapsedKey}
			count={`(${ROWS.length})`}
			rows={ROWS}
			rowKey={(r) => r.title}
			actions={(r) => <button type="button">Act on {r.title}</button>}
		/>
	);
}

const titles = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => within(row).getAllByRole('cell')[0].textContent);

beforeEach(() => localStorage.clear());

describe('ReleaseSection', () => {
	it('starts open, biggest first, with the row actions and the pack badge', () => {
		render(<Section heading="Send to Real-Debrid" collapsedKey="k:send" />);
		expect(screen.getByRole('button', { name: /Send to Real-Debrid/ })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect(titles()).toEqual(['Season packAlpha.Release.2160p', 'Bravo.Release.1080p']);
		expect(
			screen.getByRole('button', { name: 'Act on Bravo.Release.1080p' })
		).toBeInTheDocument();
	});

	it('sorts by the clicked column and flips on a second click', async () => {
		render(<Section heading="Send to Real-Debrid" collapsedKey="k:send" />);
		await userEvent.click(screen.getByRole('button', { name: /^release/i }));
		expect(titles()).toEqual(['Season packAlpha.Release.2160p', 'Bravo.Release.1080p']);
		await userEvent.click(screen.getByRole('button', { name: /^release/i }));
		expect(titles()).toEqual(['Bravo.Release.1080p', 'Season packAlpha.Release.2160p']);
	});

	it('stays collapsed on the next title, and the other section stays open', async () => {
		const first = render(<Section heading="Send to Real-Debrid" collapsedKey="k:send" />);
		await userEvent.click(screen.getByRole('button', { name: /Send to Real-Debrid/ }));
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
		// The count stays in the heading, so a folded section still says what it holds.
		expect(screen.getByText('(2)')).toBeInTheDocument();
		first.unmount();

		// Another movie's page: a fresh mount reading the same key.
		render(
			<>
				<Section heading="Send to Real-Debrid" collapsedKey="k:send" />
				<Section heading="Download from Easynews" collapsedKey="k:easynews" />
			</>
		);
		expect(screen.getByRole('button', { name: /Send to Real-Debrid/ })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect(screen.getByRole('button', { name: /Download from Easynews/ })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect(screen.getAllByRole('table')).toHaveLength(1);

		await userEvent.click(screen.getByRole('button', { name: /Send to Real-Debrid/ }));
		expect(screen.getAllByRole('table')).toHaveLength(2);
	});
});
