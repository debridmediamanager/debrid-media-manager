import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import toast, { Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showEpisodeSummary } from './EpisodeSummaryToast';

// Exercise the actual notification store/timers, not a mocked duration option.
describe('every-episode final summary', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addListener() {},
			removeListener() {},
		}));
	});

	afterEach(() => {
		act(() => toast.remove());
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it.each([true, false])('keeps totals until explicitly dismissed (success=%s)', (successful) => {
		render(<Toaster />);
		act(() => {
			showEpisodeSummary('Episodes 1-10: 8 added, 2 not found (Episodes 3, 9)', successful);
		});
		act(() => vi.advanceTimersByTime(60_000));
		expect(screen.getByText(/8 added, 2 not found/)).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss episode summary' }));
		act(() => vi.advanceTimersByTime(1001));
		expect(screen.queryByText(/8 added, 2 not found/)).toBeNull();
	});
});
