import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEventLoopStallMonitor } from './eventLoopStallMonitor';

describe('startEventLoopStallMonitor', () => {
	let clock: number;
	let warnings: string[];
	let stop: () => void;

	beforeEach(() => {
		vi.useFakeTimers();
		clock = 0;
		warnings = [];
		stop = startEventLoopStallMonitor({
			intervalMs: 250,
			thresholdMs: 500,
			now: () => clock,
			warn: (message) => warnings.push(message),
		});
	});

	afterEach(() => {
		stop();
		vi.useRealTimers();
	});

	function tick(lateByMs: number) {
		clock += 250 + lateByMs;
		vi.advanceTimersByTime(250);
	}

	it('stays quiet while ticks arrive on time or slightly late', () => {
		tick(0);
		tick(120);
		tick(499);
		expect(warnings).toEqual([]);
	});

	it('reports a tick that fires a stall late', () => {
		tick(0);
		tick(1800);
		expect(warnings).toEqual(['[event-loop] blocked for 1800ms']);
	});

	it('measures each stall from the previous tick, not from start', () => {
		tick(900);
		tick(0);
		tick(600);
		expect(warnings).toEqual([
			'[event-loop] blocked for 900ms',
			'[event-loop] blocked for 600ms',
		]);
	});

	it('stops reporting once stopped', () => {
		stop();
		tick(5000);
		expect(warnings).toEqual([]);
	});
});
