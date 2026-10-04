export async function register() {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return;
	const { startEventLoopStallMonitor } = await import('./utils/eventLoopStallMonitor');
	startEventLoopStallMonitor();
}
