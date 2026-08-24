import type { NextApiRequest, NextApiResponse } from 'next';

import { repository } from '@/services/repository';

export type HistoryRange = '24h' | '7d' | '30d' | '90d';
export type HistoryType = 'stream' | 'servers' | 'rd' | 'torrentio' | 'torbox' | 'torbox-api';

interface HistoryQuery {
	type?: HistoryType;
	range?: HistoryRange;
	sortBy?: 'reliability' | 'latency';
	limit?: string;
}

function parseRange(range: HistoryRange): {
	hoursBack?: number;
	daysBack: number;
	useDaily: boolean;
} {
	switch (range) {
		case '24h':
			return { hoursBack: 24, daysBack: 1, useDaily: false };
		case '7d':
			return { hoursBack: 168, daysBack: 7, useDaily: false };
		case '30d':
			return { daysBack: 30, useDaily: true };
		case '90d':
			return { daysBack: 90, useDaily: true };
		default:
			return { hoursBack: 24, daysBack: 1, useDaily: false };
	}
}

// Max hourly retention in hours (90 days)
const MAX_HOURLY_HOURS = 2160;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	// No caching to ensure consistency with the main status page
	res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
	res.setHeader('Pragma', 'no-cache');

	const query = req.query as HistoryQuery;
	const type = query.type ?? 'stream';
	const range = (query.range ?? '24h') as HistoryRange;
	const { hoursBack, daysBack, useDaily } = parseRange(range);

	try {
		switch (type) {
			case 'stream': {
				if (useDaily) {
					const dailyData = await repository.getStreamDailyHistory(daysBack);
					if (dailyData.length > 0) {
						return res.status(200).json({
							type: 'stream',
							granularity: 'daily',
							range,
							data: dailyData,
						});
					}
					// Fall back to hourly if daily rollup hasn't run yet
					const hourlyData = await repository.getStreamHourlyHistory(MAX_HOURLY_HOURS);
					return res.status(200).json({
						type: 'stream',
						granularity: 'hourly',
						range,
						data: hourlyData,
					});
				}
				const data = await repository.getStreamHourlyHistory(hoursBack!);
				return res.status(200).json({
					type: 'stream',
					granularity: 'hourly',
					range,
					data,
				});
			}

			case 'servers': {
				const sortBy = query.sortBy ?? 'reliability';
				const limit = query.limit ? parseInt(query.limit, 10) : 50;
				const data = await repository.getServerReliability(daysBack, sortBy, limit);
				return res.status(200).json({
					type: 'servers',
					range,
					sortBy,
					data,
				});
			}

			case 'rd': {
				if (useDaily) {
					const dailyData = await repository.getRdDailyHistory(daysBack);
					if (dailyData.length > 0) {
						return res.status(200).json({
							type: 'rd',
							granularity: 'daily',
							range,
							data: dailyData,
						});
					}
					const hourlyData = await repository.getRdHourlyHistory(MAX_HOURLY_HOURS);
					return res.status(200).json({
						type: 'rd',
						granularity: 'hourly',
						range,
						data: hourlyData,
					});
				}
				const data = await repository.getRdHourlyHistory(hoursBack!);
				return res.status(200).json({
					type: 'rd',
					granularity: 'hourly',
					range,
					data,
				});
			}

			case 'torrentio': {
				if (useDaily) {
					const dailyData = await repository.getTorrentioDailyHistory(daysBack);
					if (dailyData.length > 0) {
						return res.status(200).json({
							type: 'torrentio',
							granularity: 'daily',
							range,
							data: dailyData,
						});
					}
					const hourlyData = await repository.getTorrentioHourlyHistory(MAX_HOURLY_HOURS);
					return res.status(200).json({
						type: 'torrentio',
						granularity: 'hourly',
						range,
						data: hourlyData,
					});
				}
				const data = await repository.getTorrentioHourlyHistory(hoursBack!);
				return res.status(200).json({
					type: 'torrentio',
					granularity: 'hourly',
					range,
					data,
				});
			}

			case 'torbox': {
				if (useDaily) {
					const dailyData = await repository.getTorBoxDailyHistory(daysBack);
					if (dailyData.length > 0) {
						return res.status(200).json({
							type: 'torbox',
							granularity: 'daily',
							range,
							data: dailyData,
						});
					}
					// Fall back to hourly until the first daily rollup has run.
					const hourlyData = await repository.getTorBoxHourlyHistory(MAX_HOURLY_HOURS);
					return res.status(200).json({
						type: 'torbox',
						granularity: 'hourly',
						range,
						data: hourlyData,
					});
				}
				const data = await repository.getTorBoxHourlyHistory(hoursBack!);
				return res.status(200).json({
					type: 'torbox',
					granularity: 'hourly',
					range,
					data,
				});
			}

			case 'torbox-api': {
				if (useDaily) {
					const dailyData = await repository.getTorBoxOperationalDailyHistory(daysBack);
					if (dailyData.length > 0) {
						return res.status(200).json({
							type: 'torbox-api',
							granularity: 'daily',
							range,
							data: dailyData,
						});
					}
					const hourlyData =
						await repository.getTorBoxOperationalHourlyHistory(MAX_HOURLY_HOURS);
					return res.status(200).json({
						type: 'torbox-api',
						granularity: 'hourly',
						range,
						data: hourlyData,
					});
				}
				const data = await repository.getTorBoxOperationalHourlyHistory(hoursBack!);
				return res.status(200).json({
					type: 'torbox-api',
					granularity: 'hourly',
					range,
					data,
				});
			}

			default:
				return res.status(400).json({ error: 'Invalid type parameter' });
		}
	} catch (error) {
		console.error('Failed to fetch history data:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
