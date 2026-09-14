# DMM Cast for AllDebrid - Implementation Plan

> **Historical plan. Four rows of the comparison table below are stale — corrected inline
> and listed here so nobody has to spot them.**
>
> - **RD's cached check does not exist.** `GET /torrents/instantAvailability` has been
>   **disabled since 2024-11-22** (`error_code` 37) and nothing replaced it.
> - **"RD: 1 req/500ms" understates the limit and hides the ones that matter.** RD documents
>   **250 req/min** (1 per 240 ms), and a single global figure is not safe here regardless:
>   `/unrestrict/link` needs **≥5 s** spacing and `addMagnet` about **20 s**, both
>   undocumented, both far tighter than any per-minute budget.
> - **AllDebrid's "12 req/sec, 600 req/min" are the documented figures and they contradict
>   each other** (12/s is 720/min). Measured: authenticated bursts well above 12/s are
>   tolerated, the per-minute budget is what binds, and the throttle answers **503 with an
>   empty `text/html` body** — never the documented 429.
> - **The colour scheme here disagrees with `cast-torbox.md`.** Both are superseded by
>   `AGENTS.md`: RD green `#b5d496`, AD amber `#fbc730`, TB indigo `#4f46e5`.
>
> One row worth reading twice rather than correcting: **AllDebrid's cache probe _is_ the
> upload.** There is no non-mutating probe left — `/magnet/instant` 404s and v4
> `/magnet/status` is discontinued — so a miss has to be deleted again afterwards or
> AllDebrid downloads it. `services/allDebrid.ts` already documents this at `isAdMagnetInstant`.
>
> The architecture sections below are still accurate and are why this file is kept.

## Overview

This document outlines a comprehensive plan to create "DMM Cast for AllDebrid" - a Stremio addon system for AllDebrid users, following the same architecture as DMM Cast for Real-Debrid and TorBox. The implementation will maintain complete separation while reusing shared patterns.

---

## Key Differences: AllDebrid vs Real-Debrid vs TorBox

| Feature         | Real-Debrid                      | TorBox                          | AllDebrid                             |
| --------------- | -------------------------------- | ------------------------------- | ------------------------------------- |
| Authentication  | OAuth (4 tokens)                 | Simple API Key                  | PIN-based flow → API Key              |
| User ID Source  | Username                         | Email                           | Username                              |
| Link Generation | `POST /unrestrict/link`          | `GET /torrents/requestdl`       | Links in `/magnet/files` response     |
| File Selection  | Required                         | Not needed                      | Not needed                            |
| Rate Limits     | 250 req/min; unrestrict ≥5s      | 5 req/sec                       | 600 req/min binds; throttle is 503    |
| Permalinks      | No                               | Yes (`?redirect=true`)          | No (links expire)                     |
| Magnet Upload   | `POST /torrents/addMagnet`       | `POST /torrents/createtorrent`  | `POST /magnet/upload`                 |
| Magnet Status   | `GET /torrents/info/{id}`        | `GET /torrents/mylist?id=`      | `POST /v4.1/magnet/status`            |
| Magnet Delete   | `DELETE /torrents/delete/{id}`   | `POST /torrents/controltorrent` | `POST /magnet/delete`                 |
| Cached Check    | None — disabled since 2024-11-22 | `GET /torrents/checkcached`     | `ready` on upload — the probe mutates |
| Files Structure | Flat array                       | Flat array                      | Nested tree (folders)                 |

---

## AllDebrid API Key Points

### Authentication Flow (PIN-based)

```
1. GET /v4.1/pin/get → Returns { pin, check, user_url, expires_in }
2. User visits user_url and enters PIN
3. Poll POST /v4/pin/check with { pin, check } until activated=true
4. Receive { apikey } when activated
```

### Magnet Flow

```
1. POST /v4/magnet/upload { magnets[] } → Returns { id, hash, ready, name, size }
2. If ready=true, magnet is instantly available (cached)
3. POST /v4.1/magnet/status { id } → Returns status with statusCode
4. POST /v4/magnet/files { id[] } → Returns files with download links
5. Download links are directly usable (no unrestrict step needed!)
```

### Status Codes

| Code | Status             | Type       |
| ---- | ------------------ | ---------- |
| 0    | In Queue           | Processing |
| 1    | Downloading        | Processing |
| 2    | Compressing/Moving | Processing |
| 3    | Uploading          | Processing |
| 4    | Ready              | Finished   |
| 5-15 | Various errors     | Error      |

### Files Structure

AllDebrid uses a nested tree structure for files:

```json
{
	"files": [
		{
			"n": "FolderName", // name
			"e": [
				// entries (sub-files/folders)
				{
					"n": "movie.mkv", // filename
					"s": 5665497088, // size in bytes
					"l": "https://..." // direct download link
				}
			]
		}
	]
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   DMM Cast for AllDebrid Architecture                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐  │
│  │   Frontend      │────▶│  API Routes       │────▶│ AllDebrid Svc   │  │
│  │ /stremio-alldebrid│   │  /api/stremio-ad/ │     │ (allDebrid.ts)  │  │
│  └─────────────────┘     └────────┬──────────┘     └─────────────────┘  │
│                                   │                                      │
│                                   ▼                                      │
│                          ┌────────────────┐                              │
│                          │    Database    │                              │
│                          │    (Prisma)    │                              │
│                          │ AllDebridCast, │                              │
│                          │ AllDebridCastProfile │                        │
│                          └────────────────┘                              │
│                                   │                                      │
│                                   ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Stremio Addon API                              │  │
│  │  /api/stremio-ad/[userid]/manifest.json                           │  │
│  │  /api/stremio-ad/[userid]/catalog/{type}/{id}.json                │  │
│  │  /api/stremio-ad/[userid]/stream/{type}/{imdbid}.json             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## URL Structure & Branding Differentiation

### Existing DMM Cast for Real-Debrid - UNCHANGED URLs

- Page: `/stremio`
- API: `/api/stremio/[userid]/...`
- Manifest ID: `com.debridmediamanager.cast`
- Addon Name: "DMM Cast for Real-Debrid"
- localStorage keys: `rd:*`
- Color: Green
- Logo: `https://static.debridmediamanager.com/greenlogo.jpeg`

### DMM Cast for TorBox

- Page: `/stremio-torbox`
- API: `/api/stremio-tb/[userid]/...`
- Manifest ID: `com.debridmediamanager.cast.torbox`
- Addon Name: "DMM Cast for TorBox"
- Catalog Names: "DMM TB Movies", "DMM TB TV Shows", "DMM TB Library"
- Stream Name: "DMM Cast TB✨"
- Credit Line: "🎬 DMM Cast TB"
- localStorage keys: `tb:*`
- Color: Purple
- Logo: `https://static.debridmediamanager.com/dmmcast.png`

### DMM Cast for AllDebrid (NEW)

- Page: `/stremio-alldebrid`
- API: `/api/stremio-ad/[userid]/...`
- Manifest ID: `com.debridmediamanager.cast.alldebrid`
- Addon Name: "DMM Cast for AllDebrid"
- Catalog Names: "DMM AD Movies", "DMM AD TV Shows", "DMM AD Library"
- Stream Name: "DMM Cast AD✨"
- Credit Line: "🎬 DMM Cast AD"
- localStorage keys: `ad:*`
- Color: Yellow/Amber
- Logo: `https://static.debridmediamanager.com/yellowlogo.jpeg`

---

## Database Schema Changes

### New Prisma Models

```prisma
// AllDebrid Cast - stores individual casted content
model AllDebridCast {
  id        String   @id @default(uuid())
  imdbId    String           // IMDB ID (format: tt1234567 or tt1234567:S:E)
  userId    String           // 12-character hashed user ID (from AD username)
  hash      String           // Torrent hash
  url       String   @db.Text // Direct stream URL
  updatedAt DateTime @updatedAt
  size      BigInt   @default(0)  // File size in MB
  magnetId  Int?             // AllDebrid magnet ID (for status/cleanup)
  filename  String?          // Original filename

  @@unique([imdbId, userId, hash])
  @@index([imdbId, userId, updatedAt])
}

// AllDebrid Cast Profile - stores user API key and preferences
model AllDebridCastProfile {
  userId            String   @id    // 12-character hashed user ID
  apiKey            String          // AllDebrid API key (encrypted)
  updatedAt         DateTime @updatedAt
  movieMaxSize      Float    @default(0)   // Max movie size filter (GB)
  episodeMaxSize    Float    @default(0)   // Max episode size filter (GB)
  otherStreamsLimit Int      @default(5)   // Max community streams (0-5)
}
```

---

## Implementation Tasks

### Phase 1: Database & Core Services

#### 1.1 Update Prisma Schema

**File:** `prisma/schema.prisma`

Add the two new models:

- `AllDebridCast`
- `AllDebridCastProfile`

Run migrations:

```bash
npx prisma migrate dev --name add_alldebrid_cast_tables
```

#### 1.2 Create AllDebrid Cast Database Service

**New File:** `src/services/database/allDebridCast.ts`

```typescript
export class AllDebridCastService extends DatabaseClient {
	// Core profile methods
	saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number
	);
	getCastProfile(userId: string);

	// Cast CRUD operations
	saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		size: number,
		magnetId?: number,
		filename?: string
	);
	getCastURLs(imdbId: string, userId: string);
	getOtherCastURLs(imdbId: string, userId: string);

	// Catalog methods
	fetchCastedMovies(userId: string): Promise<string[]>;
	fetchCastedShows(userId: string): Promise<string[]>;
	fetchAllCastedLinks(userId: string);

	// Management methods
	deleteCastedLink(imdbId: string, userId: string, hash: string);
	getUserCastStreams(imdbId: string, userId: string, limit: number);
	getOtherStreams(imdbId: string, userId: string, limit: number, maxSize?: number);
}
```

#### 1.3 Create AllDebrid Stream URL Utility

**New File:** `src/utils/getAllDebridStreamUrl.ts`

```typescript
import { uploadMagnet, getMagnetStatus, getMagnetFiles, deleteMagnet } from '@/services/allDebrid';
import ptt from 'parse-torrent-title';

// Flatten nested file structure to find all files with links
function flattenFiles(
	files: MagnetFile[],
	parentPath: string = ''
): Array<{
	path: string;
	size: number;
	link: string;
}> {
	const result: Array<{ path: string; size: number; link: string }> = [];

	for (const file of files) {
		const fullPath = parentPath ? `${parentPath}/${file.n}` : file.n;

		if (file.l) {
			// It's a file with a download link
			result.push({
				path: fullPath,
				size: file.s || 0,
				link: file.l,
			});
		} else if (file.e) {
			// It's a folder, recurse into entries
			result.push(...flattenFiles(file.e, fullPath));
		}
	}

	return result;
}

export const getAllDebridStreamUrl = async (
	apiKey: string,
	hash: string,
	fileIndex: number, // Index in flattened file list
	mediaType: string
): Promise<[string, number, number, number]> => {
	// 1. Upload magnet hash
	const uploadResult = await uploadMagnet(apiKey, [hash]);
	const magnet = uploadResult.magnets[0];

	if (magnet.error) {
		throw new Error(magnet.error.message);
	}

	const magnetId = magnet.id!;

	// 2. Wait for magnet to be ready if not instant
	if (!magnet.ready) {
		// Poll status until ready (statusCode 4)
		let attempts = 0;
		const maxAttempts = 60; // 5 minutes max

		while (attempts < maxAttempts) {
			await new Promise((resolve) => setTimeout(resolve, 5000));
			const status = await getMagnetStatus(apiKey, magnetId.toString());

			if (status.data.magnets[0]?.statusCode === 4) {
				break;
			}
			if (status.data.magnets[0]?.statusCode >= 5) {
				throw new Error(`Magnet failed: ${status.data.magnets[0].status}`);
			}
			attempts++;
		}
	}

	// 3. Get files with download links
	const filesResult = await getMagnetFiles(apiKey, [magnetId]);
	const magnetFiles = filesResult.magnets[0];

	if (magnetFiles.error) {
		throw new Error(magnetFiles.error.message);
	}

	// 4. Flatten and find the requested file
	const flatFiles = flattenFiles(magnetFiles.files || []);
	const targetFile = flatFiles[fileIndex];

	if (!targetFile) {
		throw new Error('File not found in magnet');
	}

	// 5. Parse season/episode from filename if TV
	let seasonNumber = -1;
	let episodeNumber = -1;

	if (mediaType === 'tv') {
		const info = ptt.parse(targetFile.path.split('/').pop() || '');
		seasonNumber = info.season || -1;
		episodeNumber = info.episode || -1;
	}

	const fileSize = Math.round(targetFile.size / 1024 / 1024);

	// 6. Optionally delete magnet after getting link
	// Note: AllDebrid links work even after magnet deletion
	// await deleteMagnet(apiKey, magnetId.toString());

	return [targetFile.link, seasonNumber, episodeNumber, fileSize];
};

export const getBiggestFileAllDebridStreamUrl = async (
	apiKey: string,
	hash: string
): Promise<[string, number, string]> => {
	// 1. Upload magnet
	const uploadResult = await uploadMagnet(apiKey, [hash]);
	const magnet = uploadResult.magnets[0];

	if (magnet.error) {
		throw new Error(magnet.error.message);
	}

	const magnetId = magnet.id!;

	// 2. Wait for ready if not instant
	if (!magnet.ready) {
		let attempts = 0;
		while (attempts < 60) {
			await new Promise((resolve) => setTimeout(resolve, 5000));
			const status = await getMagnetStatus(apiKey, magnetId.toString());
			if (status.data.magnets[0]?.statusCode === 4) break;
			if (status.data.magnets[0]?.statusCode >= 5) {
				throw new Error(`Magnet failed: ${status.data.magnets[0].status}`);
			}
			attempts++;
		}
	}

	// 3. Get files
	const filesResult = await getMagnetFiles(apiKey, [magnetId]);
	const magnetFiles = filesResult.magnets[0];

	if (magnetFiles.error) {
		throw new Error(magnetFiles.error.message);
	}

	// 4. Find biggest file
	const flatFiles = flattenFiles(magnetFiles.files || []);
	const biggestFile = flatFiles.reduce((prev, curr) => (curr.size > prev.size ? curr : prev));

	const fileSize = Math.round(biggestFile.size / 1024 / 1024);
	const filename = biggestFile.path.split('/').pop() || 'Unknown';

	return [biggestFile.link, fileSize, filename];
};
```

**Key Insight:** AllDebrid's `/magnet/files` endpoint returns direct download links in the `l` field - no separate "unrestrict" step needed!

---

### Phase 2: User ID Generation & Hooks

#### 2.1 Create AllDebrid User ID Generator

**New File:** `src/utils/allDebridCastApiHelpers.ts`

```typescript
import { getAllDebridUser } from '@/services/allDebrid';
import crypto from 'crypto';

export const generateAllDebridUserId = async (apiKey: string): Promise<string> => {
	// 1. Get user data from AllDebrid API
	const userData = await getAllDebridUser(apiKey);
	const username = userData.username;

	if (!username) {
		throw new Error('Invalid AllDebrid username');
	}

	// 2. Use HMAC-SHA256 with salt (prefix with 'alldebrid:' for uniqueness)
	const salt = process.env.DMMCAST_SALT ?? 'default-salt...';
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`alldebrid:${username}`)
		.digest('base64url');

	// 3. Return first 12 characters
	return hmac.slice(0, 12);
};

export const validateAllDebridApiKey = async (apiKey: string): Promise<boolean> => {
	try {
		const userData = await getAllDebridUser(apiKey);
		return !!userData?.username;
	} catch {
		return false;
	}
};

export const isAllDebridPremium = async (apiKey: string): Promise<boolean> => {
	try {
		const userData = await getAllDebridUser(apiKey);
		return userData?.isPremium === true;
	} catch {
		return false;
	}
};
```

#### 2.2 Create AllDebrid Cast Token Hook

**New File:** `src/hooks/allDebridCastToken.ts`

```typescript
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useAllDebridCastToken() {
	const [apiKey] = useLocalStorage<string>('ad:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('ad:castToken');
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		if (!apiKey) return;
		if (dmmCastToken) return;
		if (isLoading) return;

		const fetchToken = async () => {
			setIsLoading(true);
			try {
				const res = await fetch('/api/stremio-ad/id?apiKey=' + apiKey);
				const data = await res.json();

				if (data.status !== 'error' && data.id) {
					setDmmCastToken(data.id);

					// Save profile to backend
					await fetch('/api/stremio-ad/cast/saveProfile', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ apiKey }),
					});
				} else {
					toast.error(data.errorMessage || 'Failed to generate cast token');
				}
			} catch (error) {
				toast.error('Failed to fetch DMM Cast AllDebrid token.');
			} finally {
				setIsLoading(false);
			}
		};

		fetchToken();
	}, [apiKey, dmmCastToken, isLoading]);

	return dmmCastToken;
}
```

#### 2.3 Create AllDebrid PIN Auth Hook (for login flow)

**New File:** `src/hooks/allDebridAuth.ts`

```typescript
import { useState, useCallback } from 'react';
import { getPin, checkPin } from '@/services/allDebrid';
import useLocalStorage from './localStorage';

interface PinState {
	pin: string;
	check: string;
	userUrl: string;
	expiresIn: number;
}

export function useAllDebridAuth() {
	const [, setApiKey] = useLocalStorage<string>('ad:apiKey');
	const [pinState, setPinState] = useState<PinState | null>(null);
	const [isPolling, setIsPolling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const startAuth = useCallback(async () => {
		try {
			setError(null);
			const pinData = await getPin();

			setPinState({
				pin: pinData.pin,
				check: pinData.check,
				userUrl: pinData.user_url,
				expiresIn: pinData.expires_in,
			});

			// Start polling for activation
			setIsPolling(true);
			const result = await checkPin(pinData.pin, pinData.check);

			if (result.apikey) {
				setApiKey(result.apikey);
				setPinState(null);
				return result.apikey;
			}
		} catch (err: any) {
			setError(err.message || 'Authentication failed');
			setPinState(null);
		} finally {
			setIsPolling(false);
		}
		return null;
	}, [setApiKey]);

	const cancelAuth = useCallback(() => {
		setIsPolling(false);
		setPinState(null);
		setError(null);
	}, []);

	return {
		pinState,
		isPolling,
		error,
		startAuth,
		cancelAuth,
	};
}
```

---

### Phase 3: API Routes

#### 3.1 User ID Endpoint

**New File:** `src/pages/api/stremio-ad/id.ts`

```typescript
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');

	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const apiKey = req.query.apiKey as string;
	if (!apiKey) {
		return res.status(401).json({ status: 'error', errorMessage: 'Missing API key' });
	}

	try {
		const id = await generateAllDebridUserId(apiKey);
		res.status(200).json({ id });
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
```

#### 3.2 Stremio Manifest

**New File:** `src/pages/api/stremio-ad/[userid]/manifest.json.ts`

```typescript
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const manifest = {
		id: 'com.debridmediamanager.cast.alldebrid',
		name: 'DMM Cast for AllDebrid',
		version: '0.0.1',
		description: 'Cast torrents from Debrid Media Manager to Stremio using AllDebrid',
		logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
		resources: [
			{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
			{ name: 'meta', types: ['other'], idPrefixes: ['dmm-ad'] },
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{ id: 'ad-casted-movies', name: 'DMM AD Movies', type: 'movie' },
			{ id: 'ad-casted-shows', name: 'DMM AD TV Shows', type: 'series' },
			{ id: 'ad-casted-other', name: 'DMM AD Library', type: 'other' },
		],
		behaviorHints: {
			configurable: false,
			configurationRequired: false,
		},
	};

	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Cache-Control', 'public, max-age=86400');
	res.json(manifest);
}
```

#### 3.3 Catalog Endpoints

**New Files:**

- `src/pages/api/stremio-ad/[userid]/catalog/movie/ad-casted-movies.json.ts`
- `src/pages/api/stremio-ad/[userid]/catalog/series/ad-casted-shows.json.ts`
- `src/pages/api/stremio-ad/[userid]/catalog/other/ad-casted-other.json.ts`
- `src/pages/api/stremio-ad/[userid]/catalog/other/ad-casted-other/[skip].ts`

#### 3.4 Stream Endpoint

**New File:** `src/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid].ts`

```typescript
import { AllDebridCastService } from '@/services/database/allDebridCast';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new AllDebridCastService();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');

	const { userid, mediaType, imdbid } = req.query;
	const cleanImdbId = (imdbid as string).replace('.json', '');

	// 1. Validate user profile exists
	const profile = await db.getCastProfile(userid as string);
	if (!profile) {
		return res.json({ streams: [], cacheMaxAge: 0 });
	}

	// 2. Get size limits from profile
	const maxSize = mediaType === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;

	// 3. Fetch streams in parallel
	const [userCasts, otherStreams] = await Promise.all([
		db.getUserCastStreams(cleanImdbId, userid as string, 5),
		profile.otherStreamsLimit > 0
			? db.getOtherStreams(cleanImdbId, userid as string, profile.otherStreamsLimit, maxSize)
			: [],
	]);

	// 4. Build stream list
	const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://debridmediamanager.com';

	const streams = [
		// Link to cast from DMM
		{
			name: 'DMM Cast AD✨',
			title: '🔗 Cast from DMM',
			externalUrl: `${baseUrl}/stremio-alldebrid/cast/${cleanImdbId}`,
		},
		// User's own casts
		...userCasts.map((cast) => ({
			name: 'DMM Cast AD',
			title: `📺 ${cast.filename} (${cast.size}MB)\n🎬 DMM Cast AD (Yours)`,
			url: cast.url,
		})),
		// Community streams
		...otherStreams.map((stream) => ({
			name: 'DMM Cast AD',
			title: `👥 ${stream.filename} (${Math.round(stream.size)}MB)\n🎬 DMM Cast AD`,
			url: stream.url,
		})),
	];

	res.json({ streams, cacheMaxAge: 0 });
}
```

#### 3.5 Cast Operation Endpoints

**New Files:**

**Movie Cast:** `src/pages/api/stremio-ad/cast/movie/[imdbid].ts`

```typescript
import { getBiggestFileAllDebridStreamUrl } from '@/utils/getAllDebridStreamUrl';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { AllDebridCastService } from '@/services/database/allDebridCast';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new AllDebridCastService();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');

	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbid } = req.query;
	const apiKey = req.query.apiKey as string;
	const hash = req.query.hash as string;

	if (!apiKey || !hash) {
		return res.status(400).json({ error: 'Missing apiKey or hash' });
	}

	try {
		// Generate user ID
		const userId = await generateAllDebridUserId(apiKey);

		// Get stream URL (AllDebrid provides direct links)
		const [streamUrl, fileSize, filename] = await getBiggestFileAllDebridStreamUrl(
			apiKey,
			hash
		);

		// Save to database
		await db.saveCast(imdbid as string, userId, hash, streamUrl, fileSize, undefined, filename);

		res.json({
			success: true,
			filename,
			size: fileSize,
			stremioUrl: `stremio://detail/movie/${imdbid}/${imdbid}`,
		});
	} catch (error: any) {
		console.error('Error casting movie:', error);
		res.status(500).json({
			success: false,
			error: error.message || 'Failed to cast movie',
		});
	}
}
```

**Series Cast:** `src/pages/api/stremio-ad/cast/series/[imdbid].ts`

**Library Cast:** `src/pages/api/stremio-ad/cast/library/[magnetIdPlusHash].ts`

#### 3.6 Profile Management

**New Files:**

- `src/pages/api/stremio-ad/cast/saveProfile.ts`
- `src/pages/api/stremio-ad/cast/updateSizeLimits.ts`

#### 3.7 Link Management

**New Files:**

- `src/pages/api/stremio-ad/links.ts`
- `src/pages/api/stremio-ad/deletelink.ts`

---

### Phase 4: Frontend Pages

#### 4.1 Main Stremio AllDebrid Page

**New File:** `src/pages/stremio-alldebrid/index.tsx`

```tsx
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import { withAuth } from '@/utils/withAuth';
import {
	AlertTriangle,
	Cast,
	ClipboardList,
	Eye,
	Globe,
	Popcorn,
	Sparkles,
	Wand2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

export function StremioAllDebridPage() {
	const dmmCastToken = useAllDebridCastToken();
	const [hasAllDebridCredentials] = useState(() => {
		if (typeof window !== 'undefined') {
			return !!localStorage.getItem('ad:apiKey');
		}
		return false;
	});

	if (!hasAllDebridCredentials) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
				<Head>
					<title>Debrid Media Manager - Stremio AllDebrid</title>
				</Head>
				<div className="max-w-md rounded-lg border-2 border-yellow-500 bg-yellow-900/20 p-6 text-center">
					<AlertTriangle className="mx-auto mb-4 h-12 w-12 text-yellow-400" />
					<h1 className="mb-3 text-2xl font-bold text-yellow-400">AllDebrid Required</h1>
					<p className="mb-4 text-gray-300">
						You must be logged in with AllDebrid to use this Stremio Cast feature.
					</p>
					<Link
						href="/alldebrid/login"
						className="haptic-sm inline-block rounded border-2 border-yellow-500 bg-yellow-800/30 px-6 py-2 font-medium text-yellow-100 transition-colors hover:bg-yellow-700/50"
					>
						Login with AllDebrid
					</Link>
				</div>
			</div>
		);
	}

	if (!dmmCastToken) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
				<h1 className="text-center text-xl text-white">
					Debrid Media Manager is loading...
				</h1>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Stremio AllDebrid</title>
			</Head>

			<Image
				width={200}
				height={200}
				src="https://static.debridmediamanager.com/yellowlogo.jpeg"
				alt="DMM Cast AllDebrid logo"
				className="mb-4"
			/>
			<h1 className="text-2xl font-bold text-yellow-400">DMM Cast for AllDebrid</h1>

			<div className="flex flex-col items-center text-white">
				<strong>Cast from any device to Stremio</strong>

				{dmmCastToken !== 'default' && (
					<div className="mb-4 mt-4 h-max text-center leading-8">
						<Link
							href={`stremio://${window.location.origin.replace(
								/^https?:\/\//,
								''
							)}/api/stremio-ad/${dmmCastToken}/manifest.json`}
							className="text-md haptic-sm m-1 rounded border-2 border-yellow-500 bg-yellow-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-yellow-700/50"
						>
							<Wand2 className="mr-1 inline-block h-4 w-4 text-yellow-400" />
							Install
						</Link>
						<Link
							href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
								`${window.location.origin}/api/stremio-ad/${dmmCastToken}/manifest.json`
							)}`}
							className="text-md haptic-sm m-1 rounded border-2 border-yellow-500 bg-yellow-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-yellow-700/50"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Globe className="mr-1 inline-block h-4 w-4 text-blue-400" />
							Install (web)
						</Link>

						<div className="mt-2 text-gray-300">
							or copy this link and paste it in Stremio's search bar
						</div>
						<div className="mt-2 text-sm text-red-400">
							<AlertTriangle className="mr-1 inline-block h-4 w-4 text-red-400" />
							Warning: Never share this install URL with anyone.
						</div>
						<code className="mt-2 block w-full break-all rounded bg-gray-800 p-2 text-sm text-gray-300">
							{window.location.origin}/api/stremio-ad/{dmmCastToken}/manifest.json
						</code>
					</div>
				)}

				<div className="space-y-2 text-gray-300">
					<div>1. Choose a Movie or TV Show to watch in DMM</div>
					<div>
						2. Select a Torrent &gt; click "
						<Eye className="inline-block h-3 w-3 text-yellow-400" /> Look Inside" &gt;
						click "Cast (AD)"
					</div>
					<div>3. Open the *same* Movie or TV Show in Stremio</div>
					<div>4. Choose the "DMM Cast AD✨" stream</div>
					<div>
						5.{' '}
						<span className="inline-flex items-center">
							Enjoy! <Popcorn className="ml-1 inline-block h-4 w-4 text-yellow-500" />
						</span>
					</div>
				</div>

				<div className="mt-6 rounded-lg border border-yellow-500/30 bg-yellow-900/20 p-4 text-sm text-gray-300">
					<p className="mb-2 font-semibold text-yellow-400">💡 Tip:</p>
					<p>
						You can control the maximum file size for streams in the{' '}
						<Link href="/settings" className="text-yellow-400 hover:underline">
							Settings page
						</Link>
						.
					</p>
				</div>
			</div>

			<div className="mt-6 flex gap-4">
				{dmmCastToken !== 'default' && (
					<Link
						href="/stremio-alldebrid/manage"
						className="haptic-sm rounded border-2 border-yellow-500 bg-yellow-800/30 px-4 py-2 text-sm font-medium text-yellow-100 transition-colors hover:bg-yellow-700/50"
					>
						<span className="inline-flex items-center">
							<ClipboardList className="mr-1 h-4 w-4" />
							Manage Casted Links
						</span>
					</Link>
				)}
				<Link
					href="/"
					className="haptic-sm rounded border-2 border-cyan-500 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
		</div>
	);
}

export default dynamic(() => Promise.resolve(withAuth(StremioAllDebridPage)), { ssr: false });
```

#### 4.2 Management Page

**New File:** `src/pages/stremio-alldebrid/manage.tsx`

Similar to existing manage pages but with:

- Orange color scheme
- AllDebrid-specific API endpoints
- AllDebrid database queries

#### 4.3 AllDebrid Login Page (PIN Flow)

**New File:** `src/pages/alldebrid/login.tsx`

```tsx
import { useAllDebridAuth } from '@/hooks/allDebridAuth';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function AllDebridLoginPage() {
	const router = useRouter();
	const { pinState, isPolling, error, startAuth, cancelAuth } = useAllDebridAuth();
	const [countdown, setCountdown] = useState(0);

	useEffect(() => {
		if (pinState?.expiresIn) {
			setCountdown(pinState.expiresIn);
			const interval = setInterval(() => {
				setCountdown((prev) => {
					if (prev <= 1) {
						clearInterval(interval);
						return 0;
					}
					return prev - 1;
				});
			}, 1000);
			return () => clearInterval(interval);
		}
	}, [pinState]);

	const handleStartAuth = async () => {
		const apiKey = await startAuth();
		if (apiKey) {
			router.push('/stremio-alldebrid');
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<h1 className="mb-8 text-3xl font-bold text-yellow-400">Login with AllDebrid</h1>

			{!pinState && !isPolling && (
				<button
					onClick={handleStartAuth}
					className="rounded bg-yellow-600 px-6 py-3 text-lg font-semibold text-white hover:bg-yellow-700"
				>
					Start Authentication
				</button>
			)}

			{pinState && (
				<div className="text-center">
					<p className="mb-4 text-gray-300">Visit the link below and enter this PIN:</p>
					<div className="mb-4 rounded bg-gray-800 p-4">
						<span className="font-mono text-4xl font-bold text-yellow-400">
							{pinState.pin}
						</span>
					</div>
					<a
						href={pinState.userUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="mb-4 block text-yellow-400 hover:underline"
					>
						{pinState.userUrl}
					</a>
					<p className="text-sm text-gray-400">
						Expires in: {Math.floor(countdown / 60)}:
						{(countdown % 60).toString().padStart(2, '0')}
					</p>
					{isPolling && (
						<p className="mt-4 text-gray-300">Waiting for you to enter the PIN...</p>
					)}
					<button onClick={cancelAuth} className="mt-4 text-gray-400 hover:text-gray-200">
						Cancel
					</button>
				</div>
			)}

			{error && <div className="mt-4 rounded bg-red-900/50 p-4 text-red-300">{error}</div>}

			<Link href="/" className="mt-8 text-gray-400 hover:text-gray-200">
				Back to Home
			</Link>
		</div>
	);
}
```

---

### Phase 5: Cast API Client

#### 5.1 AllDebrid Cast Client

**New File:** `src/utils/allDebridCastApiClient.ts`

```typescript
import toast from 'react-hot-toast';

export const handleCastMovieAllDebrid = async (
	imdbId: string,
	apiKey: string,
	hash: string
): Promise<{ success: boolean; filename?: string; error?: string }> => {
	try {
		const response = await fetch(
			`/api/stremio-ad/cast/movie/${imdbId}?apiKey=${encodeURIComponent(apiKey)}&hash=${hash}`
		);
		const data = await response.json();

		if (data.success) {
			toast.success(`Casted ${data.filename} to Stremio`);
		} else {
			toast.error(data.error || 'Failed to cast movie');
		}

		return data;
	} catch (error: any) {
		toast.error('Network error while casting');
		return { success: false, error: error.message };
	}
};

export const handleCastTvShowAllDebrid = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	fileIndices: number[]
): Promise<{ success: boolean; results: any[]; errors: any[] }> => {
	const results: any[] = [];
	const errors: any[] = [];

	// Process in batches of 5, 4 concurrent workers (similar to RD implementation)
	const batchSize = 5;
	const concurrency = 4;

	for (let i = 0; i < fileIndices.length; i += batchSize * concurrency) {
		const batch = fileIndices.slice(i, i + batchSize * concurrency);

		const batchResults = await Promise.allSettled(
			batch.map(async (fileIndex) => {
				const response = await fetch(
					`/api/stremio-ad/cast/series/${imdbId}?apiKey=${encodeURIComponent(apiKey)}&hash=${hash}&fileIndex=${fileIndex}`
				);
				return response.json();
			})
		);

		for (const result of batchResults) {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					results.push(result.value);
				} else {
					errors.push(result.value);
				}
			} else {
				errors.push({ error: result.reason?.message || 'Unknown error' });
			}
		}
	}

	if (results.length > 0) {
		toast.success(`Casted ${results.length} episode(s) to Stremio`);
	}
	if (errors.length > 0) {
		toast.error(`${errors.length} episode(s) failed to cast`);
	}

	return { success: errors.length === 0, results, errors };
};

export const saveAllDebridCastProfile = async (apiKey: string) => {
	try {
		await fetch('/api/stremio-ad/cast/saveProfile', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ apiKey }),
		});
	} catch (error) {
		console.error('Failed to save AllDebrid cast profile:', error);
	}
};
```

---

### Phase 6: Integration with Existing UI

#### 6.1 Add AllDebrid Cast Button to Movie/TV Pages

**Modify:** `src/pages/movie/[imdbid]/index.tsx`
**Modify:** `src/pages/show/[imdbid]/[seasonNum].tsx`

Add a third "Cast (AD)" button:

```tsx
{
	hasAllDebridCredentials && (
		<button
			onClick={() => handleCastMovieAllDebrid(imdbId, apiKey, hash)}
			className="rounded bg-yellow-600 px-3 py-1 text-sm text-white hover:bg-yellow-700"
		>
			<Cast className="mr-1 inline h-4 w-4" />
			Cast (AD) {/* Button label - short form */}
		</button>
	);
}
```

#### 6.2 Settings Integration

**Modify:** `src/components/SettingsSection.tsx`

Add AllDebrid-specific size limit settings:

- `ad:movieMaxSize`
- `ad:episodeMaxSize`
- `ad:otherStreamsLimit`

#### 6.3 Navigation Updates

**Modify:** Various navigation components

Add links to `/stremio-alldebrid` alongside existing Stremio links.

---

## File Structure Summary

```
src/
├── hooks/
│   ├── allDebridCastToken.ts           # NEW: AllDebrid cast token hook
│   └── allDebridAuth.ts                # NEW: PIN auth flow hook
├── pages/
│   ├── alldebrid/
│   │   └── login.tsx                   # NEW: PIN-based login page
│   ├── stremio-alldebrid/
│   │   ├── index.tsx                   # NEW: Main page
│   │   └── manage.tsx                  # NEW: Management page
│   └── api/
│       └── stremio-ad/
│           ├── id.ts                   # NEW: User ID generation
│           ├── links.ts                # NEW: Get all links
│           ├── deletelink.ts           # NEW: Delete link
│           ├── cast/
│           │   ├── movie/
│           │   │   └── [imdbid].ts     # NEW: Cast movie
│           │   ├── series/
│           │   │   └── [imdbid].ts     # NEW: Cast TV show
│           │   ├── library/
│           │   │   └── [magnetIdPlusHash].ts # NEW: Cast from library
│           │   ├── saveProfile.ts      # NEW: Save profile
│           │   └── updateSizeLimits.ts # NEW: Update settings
│           └── [userid]/
│               ├── manifest.json.ts    # NEW: Stremio manifest
│               ├── catalog/
│               │   ├── movie/
│               │   │   └── ad-casted-movies.json.ts
│               │   ├── series/
│               │   │   └── ad-casted-shows.json.ts
│               │   └── other/
│               │       ├── ad-casted-other.json.ts
│               │       └── ad-casted-other/
│               │           └── [skip].ts
│               ├── stream/
│               │   └── [mediaType]/
│               │       └── [imdbid].ts
│               ├── meta/
│               │   └── other/
│               │       └── [id].ts
│               └── play/
│                   └── [link].ts
├── services/
│   └── database/
│       └── allDebridCast.ts            # NEW: AllDebrid cast DB service
└── utils/
    ├── getAllDebridStreamUrl.ts        # NEW: AllDebrid stream URL utility
    ├── allDebridCastApiClient.ts       # NEW: Client-side cast functions
    └── allDebridCastApiHelpers.ts      # NEW: User ID generation, validation
```

---

## AllDebrid-Specific Considerations

### 1. Nested File Structure

AllDebrid returns files in a nested tree format. The `flattenFiles()` utility function recursively traverses this structure to extract all files with their full paths and download links.

### 2. Direct Download Links

Unlike Real-Debrid (which requires unrestricting) or TorBox (which uses `requestdl`), AllDebrid provides direct download links in the `l` field of the `/magnet/files` response. This simplifies the casting flow.

### 3. No File Selection

Like TorBox, AllDebrid downloads all files automatically - no file selection step needed.

### 4. Link Expiration

AllDebrid links do expire (unlike TorBox permalinks). Consider:

- Refreshing links on stream request
- Storing magnet ID for re-fetching links
- Implementing a refresh mechanism before playback

### 5. PIN-Based Authentication

AllDebrid uses a PIN flow for authentication:

1. Get PIN from `/pin/get`
2. User visits URL and enters PIN
3. Poll `/pin/check` until activated
4. Receive API key

This is different from Real-Debrid's OAuth flow or TorBox's direct API key.

### 6. Instant Availability Check

The `ready` field in the magnet upload response indicates if the torrent is instantly available (cached). Use this to warn users about non-cached content.

### 7. Rate Limits

AllDebrid allows 12 req/sec and 600 req/min - more generous than TorBox (5 req/sec) but similar to RD. The existing rate limiting in `allDebrid.ts` uses 500 req/min for safety.

---

## UI/UX Branding

### Color Scheme

- **Real-Debrid**: Green (`green-500`, `green-800`)
- **TorBox**: Purple (`purple-500`, `purple-800`)
- **AllDebrid**: Yellow/Amber (`yellow-500`, `yellow-800`, `amber-400`)

### Icons & Logos

- Logo: `https://static.debridmediamanager.com/yellowlogo.jpeg` (already uploaded to R2)
- Use yellow cast icon for AllDebrid buttons
- AllDebrid branding in addon manifest

### MainActions Component Update

**Modify:** `src/components/MainActions.tsx`

Add AllDebrid user prop and Stremio button:

```tsx
import { RealDebridUser } from '@/hooks/auth';
import { TorBoxUser, AllDebridUser } from '@/services/types';
import { BookOpen, Rocket, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	tbUser: TorBoxUser | null;
	adUser: AllDebridUser | null; // NEW
	isLoading: boolean;
}

export function MainActions({ rdUser, tbUser, adUser, isLoading }: MainActionsProps) {
	// Count how many debrid services are logged in
	const loggedInServices = [rdUser, tbUser, adUser].filter(Boolean).length;

	return (
		<div className="grid w-full grid-cols-3 gap-3">
			{/* Library and Hash lists buttons... */}

			{/* Single service logged in - full button */}
			{loggedInServices === 1 && rdUser && (
				<Link href="/stremio" className="...border-green-500 bg-green-900/30...">
					<Sparkles className="...text-green-400" /> Stremio
				</Link>
			)}
			{loggedInServices === 1 && tbUser && (
				<Link href="/stremio-torbox" className="...border-purple-500 bg-purple-900/30...">
					<Sparkles className="...text-purple-400" /> Stremio
				</Link>
			)}
			{loggedInServices === 1 && adUser && (
				<Link
					href="/stremio-alldebrid"
					className="...border-yellow-500 bg-yellow-900/30..."
				>
					<Sparkles className="...text-yellow-400" /> Stremio
				</Link>
			)}

			{/* Two services - show both as compact buttons */}
			{loggedInServices === 2 && (
				<div className="flex gap-1">
					{rdUser && (
						<Link
							href="/stremio"
							className="...border-green-500..."
							title="DMM Cast for Real-Debrid"
						>
							<Sparkles className="...text-green-400" />
							<span className="text-xs">RD</span>
						</Link>
					)}
					{tbUser && (
						<Link
							href="/stremio-torbox"
							className="...border-purple-500..."
							title="DMM Cast for TorBox"
						>
							<Sparkles className="...text-purple-400" />
							<span className="text-xs">TB</span>
						</Link>
					)}
					{adUser && (
						<Link
							href="/stremio-alldebrid"
							className="...border-yellow-500..."
							title="DMM Cast for AllDebrid"
						>
							<Sparkles className="...text-yellow-400" />
							<span className="text-xs">AD</span>
						</Link>
					)}
				</div>
			)}

			{/* Three services - show all as compact buttons */}
			{loggedInServices === 3 && (
				<div className="flex gap-1">
					<Link
						href="/stremio"
						className="...border-green-500..."
						title="DMM Cast for Real-Debrid"
					>
						<Sparkles className="...text-green-400" />
						<span className="text-xs">RD</span>
					</Link>
					<Link
						href="/stremio-torbox"
						className="...border-purple-500..."
						title="DMM Cast for TorBox"
					>
						<Sparkles className="...text-purple-400" />
						<span className="text-xs">TB</span>
					</Link>
					<Link
						href="/stremio-alldebrid"
						className="...border-yellow-500..."
						title="DMM Cast for AllDebrid"
					>
						<Sparkles className="...text-yellow-400" />
						<span className="text-xs">AD</span>
					</Link>
				</div>
			)}
		</div>
	);
}
```

**Modify:** `src/pages/index.tsx`

Pass `adUser` prop to MainActions:

```tsx
<MainActions rdUser={rdUser} tbUser={tbUser} adUser={adUser} isLoading={isLoading} />
```

---

## Testing Plan

### Unit Tests

- `src/test/utils/getAllDebridStreamUrl.test.ts`
- `src/test/utils/allDebridCastApiHelpers.test.ts`
- `src/test/services/database/allDebridCast.test.ts`

### API Tests

- `src/test/api/stremio-ad/id.test.ts`
- `src/test/api/stremio-ad/cast/movie.test.ts`
- `src/test/api/stremio-ad/cast/series.test.ts`
- `src/test/api/stremio-ad/stream.test.ts`
- `src/test/api/stremio-ad/catalog.test.ts`

### Integration Tests

- PIN authentication flow
- End-to-end casting flow
- Stremio addon installation
- Stream playback
- Nested file structure parsing

---

## Summary

This plan creates a complete "DMM Cast for AllDebrid" feature that:

1. **Maintains Separation**: Uses unique URL paths (`/stremio-ad`), database tables, and localStorage keys (`ad:*`)

2. **Preserves Existing URLs**: Real-Debrid and TorBox addon URLs remain unchanged

3. **Leverages AllDebrid Features**:
    - Direct download links (no unrestrict step)
    - Instant availability detection
    - PIN-based authentication

4. **Handles AllDebrid Specifics**:
    - Nested file structure parsing
    - PIN authentication flow
    - Link expiration considerations

5. **Provides Clear Branding**: Distinct yellow theme to differentiate from RD (green) and TorBox (purple)

6. **Enables Multi-Provider Use**: Users can install all three addons (RD, TorBox, AllDebrid) simultaneously in Stremio

The implementation follows the established DMM Cast architecture while adapting to AllDebrid's unique API characteristics, particularly the PIN auth flow and nested file structure.
