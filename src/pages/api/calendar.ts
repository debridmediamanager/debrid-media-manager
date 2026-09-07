import { getTmdbAuthWithFreeKey, tmdbAxiosOptions } from '@/utils/tmdbAuth';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

import { getMdblistCacheService } from '@/services/database/mdblistCache';

const TRAKT_BASE_URL = 'https://api.trakt.tv';

type TraktCalendarItem = {
	first_aired?: string;
	episode?: {
		season?: number;
		number?: number;
		title?: string;
	};
	show?: {
		title?: string;
		ids?: Record<string, string | number>;
		network?: string;
		country?: string;
	};
};

type CalendarEvent = {
	title: string;
	season: number | null;
	episode: number | null;
	firstAired: string;
	isPremiere: boolean;
	source: 'trakt';
	ids: Record<string, string | number>;
	network?: string;
	country?: string;
};

type CalendarDay = {
	date: string;
	items: CalendarEvent[];
};

type CalendarResponse = {
	range: { start: string; days: number };
	days: CalendarDay[];
	tmdb: {
		airingToday: {
			id: number;
			name: string;
			first_air_date?: string;
			poster_path?: string;
			next_episode_to_air?: {
				season_number?: number;
				episode_number?: number;
				air_date?: string;
			};
		}[];
		onTheAir: {
			id: number;
			name: string;
			first_air_date?: string;
			poster_path?: string;
			next_episode_to_air?: {
				season_number?: number;
				episode_number?: number;
				air_date?: string;
			};
		}[];
	};
};

const makeEventKey = (event: CalendarEvent, dateOverride?: string) => {
	const ids = event.ids || {};
	const primary =
		(ids.imdb as string) ||
		(ids.slug as string) ||
		(ids.trakt as string) ||
		`${event.title || ''}`;
	const season = event.season ?? 's';
	const episode = event.episode ?? 'e';
	const date = dateOverride || toISODate(event.firstAired) || event.firstAired;
	return `${primary}-${season}-${episode}-${date}`;
};

const addEventToDay = (
	grouped: Map<string, CalendarEvent[]>,
	day: string,
	event: CalendarEvent
) => {
	const items = grouped.get(day) || [];
	const key = makeEventKey(event, day);
	const existing = items.find((ev) => makeEventKey(ev, day) === key);
	if (existing) {
		existing.isPremiere = existing.isPremiere || event.isPremiere;
		grouped.set(day, items);
		return;
	}
	items.push(event);
	grouped.set(day, items);
};

const resolveTraktClientId = () => {
	const { publicRuntimeConfig } = getConfig();
	return process.env.TRAKT_CLIENT_ID || publicRuntimeConfig?.traktClientId;
};

const toISODate = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
};

const mapTraktItems = (items: TraktCalendarItem[], isPremiere: boolean) => {
	const grouped = new Map<string, CalendarEvent[]>();

	for (const item of items) {
		if (!item.first_aired) continue;
		const day = toISODate(item.first_aired);
		if (!day) continue;

		const event: CalendarEvent = {
			title: item.show?.title || 'Unknown title',
			season: item.episode?.season ?? null,
			episode: item.episode?.number ?? null,
			firstAired: item.first_aired,
			isPremiere,
			source: 'trakt',
			ids: item.show?.ids || {},
			network: item.show?.network || item.show?.country,
			country: item.show?.country?.toLowerCase(),
		};

		addEventToDay(grouped, day, event);
	}

	return grouped;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { start, days } = req.query;

	const startDate =
		typeof start === 'string' && start ? start : new Date().toISOString().slice(0, 10);
	const dayCount = Math.min(Math.max(parseInt(String(days ?? ''), 10) || 7, 1), 31);
	const cacheKey = `calendar_${startDate}_${dayCount}`;
	const cacheTtlMs = 60 * 60 * 1000; // 1 hour
	const cache = getMdblistCacheService();

	try {
		const cached = await cache.getWithMetadata(cacheKey);
		if (cached) {
			const ageMs = Date.now() - cached.updatedAt.getTime();
			if (ageMs < cacheTtlMs) {
				res.setHeader('Cache-Control', 'public, max-age=3600');
				return res.status(200).json(cached.data as CalendarResponse);
			}
		}
	} catch (err) {
		console.error('Calendar cache read failed', err);
	}

	const traktClientId = resolveTraktClientId();
	if (!traktClientId) {
		return res.status(400).json({ error: 'TRAKT_CLIENT_ID not configured' });
	}

	const traktHeaders = {
		'Content-Type': 'application/json',
		'trakt-api-version': '2',
		'trakt-api-key': traktClientId,
	};

	const tmdbAuth = getTmdbAuthWithFreeKey();

	try {
		const [allResp, premieresResp, airingTodayResp, onTheAirResp] = await Promise.all([
			axios.get<TraktCalendarItem[]>(
				`${TRAKT_BASE_URL}/calendars/all/shows/${startDate}/${dayCount}`,
				{
					headers: traktHeaders,
					params: { extended: 'full' },
				}
			),
			axios.get<TraktCalendarItem[]>(
				`${TRAKT_BASE_URL}/calendars/all/shows/premieres/${startDate}/${dayCount}`,
				{
					headers: traktHeaders,
					params: { extended: 'full' },
				}
			),
			axios.get(`https://api.themoviedb.org/3/tv/airing_today`, tmdbAxiosOptions(tmdbAuth)),
			axios.get(`https://api.themoviedb.org/3/tv/on_the_air`, tmdbAxiosOptions(tmdbAuth)),
		]);

		const combinedDays = mapTraktItems(allResp.data, false);
		const premiereDays = mapTraktItems(premieresResp.data, true);

		for (const [day, events] of premiereDays.entries()) {
			for (const event of events) {
				addEventToDay(combinedDays, day, event);
			}
		}

		const daysArray: CalendarDay[] = Array.from(combinedDays.entries())
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([date, items]) => ({
				date,
				items: items.sort(
					(a, b) => new Date(a.firstAired).getTime() - new Date(b.firstAired).getTime()
				),
			}));

		const tmdbAiringToday = Array.isArray(airingTodayResp.data?.results)
			? airingTodayResp.data.results.map((item: any) => ({
					id: item.id,
					name: item.name,
					first_air_date: item.first_air_date,
					poster_path: item.poster_path,
					next_episode_to_air: item.next_episode_to_air,
				}))
			: [];

		const tmdbOnTheAir = Array.isArray(onTheAirResp.data?.results)
			? onTheAirResp.data.results.map((item: any) => ({
					id: item.id,
					name: item.name,
					first_air_date: item.first_air_date,
					poster_path: item.poster_path,
					next_episode_to_air: item.next_episode_to_air,
				}))
			: [];

		const payload: CalendarResponse = {
			range: { start: startDate, days: dayCount },
			days: daysArray,
			tmdb: { airingToday: tmdbAiringToday, onTheAir: tmdbOnTheAir },
		};

		try {
			await cache.set(cacheKey, 'calendar', payload);
		} catch (err) {
			console.error('Calendar cache write failed', err);
		}

		res.setHeader('Cache-Control', 'public, max-age=3600');
		return res.status(200).json(payload);
	} catch (error: any) {
		console.error('Calendar fetch failed', error?.response?.status, error?.message);
		return res.status(500).json({ error: 'Failed to load calendar data' });
	}
}
