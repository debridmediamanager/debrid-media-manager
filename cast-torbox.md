# DMM Cast for TorBox - Implementation Plan

> **Historical plan. The corrections below supersede the original proposals.**
>
> - **RD's cached check does not exist.** `GET /torrents/instantAvailability/{hash}` has been
>   **disabled since 2024-11-22** (`error_code` 37) and nothing replaced it. Real-Debrid has
>   no cache probe.
> - **"RD: 1 req/500ms" understates the limit and hides the ones that matter.** RD documents
>   **250 req/min**, which is 1 per 240 ms. More importantly a single global figure is not
>   safe here at all: `/unrestrict/link` needs **≥5 s** spacing and `addMagnet` about **20 s**,
>   both undocumented and both far tighter than any per-minute budget. 500 ms breaches both.
> - **The colour scheme here disagrees with `cast-alldebrid.md`.** Both are superseded by
>   `AGENTS.md`: RD green `#b5d496`, AD amber `#fbc730`, TB indigo `#4f46e5`.
>
> TorBox playback uses a stable DMM play endpoint, not a permanent TorBox delivery URL.
> The safety requirements in §7.1 and Security Considerations apply to the implementation.

## Overview

This document outlines a comprehensive plan to create "DMM Cast for TorBox" - a Stremio addon system for TorBox users, similar to the existing DMM Cast for Real-Debrid. The implementation will maintain complete separation from the Real-Debrid version while reusing shared patterns and components where appropriate.

---

## Key Differences: TorBox vs Real-Debrid

| Feature          | Real-Debrid                                               | TorBox                                                                    |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Authentication   | OAuth (clientId, clientSecret, refreshToken, accessToken) | Simple API Key (Bearer token)                                             |
| Link Generation  | `POST /unrestrict/link`                                   | `GET /torrents/requestdl?token=&torrent_id=&file_id=`                     |
| File Selection   | Required: `POST /torrents/selectFiles/{id}`               | Not needed - TorBox downloads all files automatically                     |
| User Info        | `GET /user` returns `username`                            | `GET /user/me` returns `email` (use email hash for userId)                |
| Rate Limits      | 250 req/min; unrestrict ≥5s, addMagnet ~20s               | 5 req/sec (more generous)                                                 |
| Permalinks       | DMM resolves playback for the caller                      | DMM play endpoint resolves for the caller; `redirect=true` only redirects |
| Torrent Creation | `POST /torrents/addMagnet`                                | `POST /torrents/createtorrent`                                            |
| Torrent Deletion | `DELETE /torrents/delete/{id}`                            | `POST /torrents/controltorrent` with `operation: 'delete'`                |
| Cached Check     | None — `instantAvailability` disabled since 2024-11-22    | `GET /torrents/checkcached?hash=`                                         |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DMM Cast for TorBox Architecture                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐  │
│  │   Frontend      │────▶│  API Routes       │────▶│  TorBox Service │  │
│  │  /stremio-torbox│     │  /api/stremio-tb/ │     │  (torbox.ts)    │  │
│  └─────────────────┘     └────────┬──────────┘     └─────────────────┘  │
│                                   │                                      │
│                                   ▼                                      │
│                          ┌────────────────┐                              │
│                          │    Database    │                              │
│                          │    (Prisma)    │                              │
│                          │ TorBoxCast,    │                              │
│                          │ TorBoxCastProfile │                           │
│                          └────────────────┘                              │
│                                   │                                      │
│                                   ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Stremio Addon API                              │  │
│  │  /api/stremio-tb/[userid]/manifest.json                           │  │
│  │  /api/stremio-tb/[userid]/catalog/{type}/{id}.json                │  │
│  │  /api/stremio-tb/[userid]/stream/{type}/{imdbid}.json             │  │
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
- Catalog Names: "DMM RD Movies", "DMM RD TV Shows", "DMM RD Library"
- Stream Name: "DMM Cast RD✨"
- Credit Line: "🎬 DMM Cast RD"
- localStorage keys: `rd:*`
- Color: Purple

### New DMM Cast for TorBox

- Page: `/stremio-torbox`
- API: `/api/stremio-tb/[userid]/...`
- Manifest ID: `com.debridmediamanager.cast.torbox`
- Addon Name: "DMM Cast for TorBox"
- Catalog Names: "DMM TB Movies", "DMM TB TV Shows", "DMM TB Library"
- Stream Name: "DMM Cast TB✨"
- Credit Line: "🎬 DMM Cast TB"
- localStorage keys: `tb:*`
- Color: Green

---

## Database Schema Changes

### Option A: Separate Tables (Recommended)

Add new models for complete isolation:

```prisma
// TorBox Cast - stores individual casted content
model TorBoxCast {
  id        String   @id @default(uuid())
  imdbId    String           // IMDB ID (format: tt1234567 or tt1234567:S:E)
  userId    String           // 12-character hashed user ID (from TorBox email)
  hash      String           // Torrent hash
  url       String   @db.Text // Display filename, not a shareable TorBox URL
  updatedAt DateTime @updatedAt
  size      BigInt   @default(0)  // File size in MB
  torrentId Int?             // Owner-scoped TorBox torrent ID; not proof cleanup is safe
  fileId    Int?             // TorBox file ID within torrent

  @@unique([imdbId, userId, hash])
  @@index([imdbId, userId, updatedAt])
}

// TorBox Cast Profile - stores user API key and preferences
model TorBoxCastProfile {
  userId            String   @id    // 12-character hashed user ID
  apiKey            String          // TorBox API key (encrypted)
  updatedAt         DateTime @updatedAt
  movieMaxSize      Float    @default(0)   // Max movie size filter (GB)
  episodeMaxSize    Float    @default(0)   // Max episode size filter (GB)
  otherStreamsLimit Int      @default(5)   // Max community streams (0-5)
}
```

### Option B: Unified Tables with Provider Field

Extend existing models (more complex, not recommended):

```prisma
model Cast {
  // ... existing fields ...
  provider  String @default("rd")  // "rd" | "tb"
  torrentId Int?   // TorBox-specific
  fileId    Int?   // TorBox-specific

  @@unique([imdbId, userId, hash, provider])
}
```

**Recommendation**: Use Option A (separate tables) for cleaner separation and easier maintenance.

---

## Implementation Tasks

### Phase 1: Database & Core Services

#### 1.1 Update Prisma Schema

**File:** `prisma/schema.prisma`

Add the two new models:

- `TorBoxCast`
- `TorBoxCastProfile`

Run migrations:

```bash
npx prisma migrate dev --name add_torbox_cast_tables
```

#### 1.2 Create TorBox Cast Database Service

**New File:** `src/services/database/torboxCast.ts`

```typescript
export class TorBoxCastService extends DatabaseClient {
	// Mirrors CastService but for TorBox tables
	saveCastProfile(userId, apiKey, movieMaxSize?, episodeMaxSize?, otherStreamsLimit?);
	getCastProfile(userId);
	saveCast(imdbId, userId, hash, url, size, torrentId?, fileId?);
	getCastURLs(imdbId, userId);
	getOtherCastURLs(imdbId, userId);
	fetchCastedMovies(userId);
	fetchCastedShows(userId);
	fetchAllCastedLinks(userId);
	deleteCastedLink(imdbId, userId, hash);
	getUserCastStreams(imdbId, userId, limit);
	getOtherStreams(imdbId, userId, limit, maxSize?);
}
```

#### 1.3 Create TorBox Stream URL Utility

**New File:** `src/utils/getTorBoxStreamUrl.ts`

```typescript
import {
	createTorrent,
	getTorrentList,
	requestDownloadLink,
	deleteTorrent,
} from '@/services/torbox';
import ptt from 'parse-torrent-title';

export const getTorBoxStreamUrl = async (
	apiKey: string,
	hash: string,
	fileId: number,
	mediaType: string
): Promise<[string, number, number, number]> => {
	// 1. Snapshot the complete paginated library before adding a missing hash
	// 2. Reuse/poll held torrents; require download_finished && download_present
	// 3. Request a delivery URL with the caller's own key
	// 4. Parse season/episode from filename if TV
	// 5. Cleanup only a torrent proven to have been created by this operation
	// Returns: [streamUrl, seasonNumber, episodeNumber, fileSize]
};

export const getBiggestFileTorBoxStreamUrl = async (
	apiKey: string,
	hash: string
): Promise<[string, number]> => {
	// Similar but finds biggest file automatically
	// Returns: [streamUrl, fileSize]
};
```

**Key Difference:** A stable DMM play URL resolves the torrent/file and requests a TorBox delivery URL for the caller. `redirect=true` changes the TorBox response into a redirect; it does not make the credential-bearing destination permanent or safe to share.

---

### Phase 2: User ID Generation & Hooks

#### 2.1 Create TorBox User ID Generator

**New File:** `src/utils/torboxCastApiHelpers.ts`

```typescript
import { getUserData } from '@/services/torbox';
import crypto from 'crypto';

export const generateTorBoxUserId = async (apiKey: string): Promise<string> => {
	// 1. Get user data from TorBox API
	const userData = await getUserData(apiKey);
	const email = userData.data.email;

	if (!email) {
		throw new Error('Invalid TorBox email');
	}

	// 2. Use HMAC-SHA256 with salt
	const salt = process.env.DMMCAST_SALT ?? 'default-salt...';
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`torbox:${email}`) // Prefix with 'torbox:' to ensure different IDs
		.digest('base64url');

	// 3. Return first 12 characters
	return hmac.slice(0, 12);
};

export const validateTorBoxApiKey = async (apiKey: string): Promise<boolean> => {
	try {
		const userData = await getUserData(apiKey);
		return userData.success && userData.data?.email;
	} catch {
		return false;
	}
};
```

#### 2.2 Create TorBox Cast Token Hook

**New File:** `src/hooks/torboxCastToken.ts`

```typescript
import { useEffect } from 'react';
import useLocalStorage from './localStorage';

export function useTorBoxCastToken() {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('tb:castToken');

	useEffect(() => {
		if (!apiKey) return;
		if (dmmCastToken) return;

		const fetchToken = async () => {
			try {
				const res = await fetch('/api/stremio-tb/id?apiKey=' + apiKey);
				const data = await res.json();
				if (data.status !== 'error') {
					setDmmCastToken(data.id);
					// Save profile to backend
					await fetch('/api/stremio-tb/cast/saveProfile', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ apiKey }),
					});
				}
			} catch (error) {
				toast.error('Failed to fetch DMM Cast TorBox token.');
			}
		};

		fetchToken();
	}, [apiKey, dmmCastToken]);

	return dmmCastToken;
}
```

---

### Phase 3: API Routes

#### 3.1 User ID Endpoint

**New File:** `src/pages/api/stremio-tb/id.ts`

```typescript
export default async function handler(req, res) {
	const apiKey = req.query.apiKey;
	if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

	try {
		const id = await generateTorBoxUserId(apiKey);
		res.status(200).json({ id });
	} catch (error) {
		res.status(500).json({ status: 'error', errorMessage: error.message });
	}
}
```

#### 3.2 Stremio Manifest

**New File:** `src/pages/api/stremio-tb/[userid]/manifest.json.ts`

```typescript
export default async function handler(req, res) {
	const manifest = {
		id: 'com.debridmediamanager.cast.torbox',
		name: 'DMM Cast for TorBox',
		version: '0.0.1',
		description: 'Cast torrents from Debrid Media Manager to Stremio using TorBox',
		logo: 'https://static.debridmediamanager.com/dmmcast-torbox.png',
		resources: [
			{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
			{ name: 'meta', types: ['other'], idPrefixes: ['dmm-tb'] },
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{ id: 'tb-casted-movies', name: 'DMM TB Movies', type: 'movie' },
			{ id: 'tb-casted-shows', name: 'DMM TB TV Shows', type: 'series' },
			{ id: 'tb-casted-other', name: 'DMM TB Library', type: 'other' },
		],
		behaviorHints: {
			configurable: false,
			configurationRequired: false,
		},
	};

	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.json(manifest);
}
```

#### 3.3 Catalog Endpoints

**New Files:**

- `src/pages/api/stremio-tb/[userid]/catalog/movie/tb-casted-movies.json.ts`
- `src/pages/api/stremio-tb/[userid]/catalog/series/tb-casted-shows.json.ts`
- `src/pages/api/stremio-tb/[userid]/catalog/other/tb-casted-other.json.ts`
- `src/pages/api/stremio-tb/[userid]/catalog/other/tb-casted-other/[skip].ts`

#### 3.4 Stream Endpoint

**New File:** `src/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid].ts`

```typescript
export default async function handler(req, res) {
	const { userid, mediaType, imdbid } = req.query;

	// 1. Validate user profile exists
	const profile = await db.getCastProfile(userid);
	if (!profile) {
		return res.json({ streams: [] });
	}

	// 2. Get size limits from profile
	const maxSize = mediaType === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;

	// 3. Fetch streams in parallel
	const [userCasts, otherStreams] = await Promise.all([
		db.getUserCastStreams(imdbid, userid, 5),
		db.getOtherStreams(imdbid, userid, profile.otherStreamsLimit, maxSize),
	]);

	// 4. Build stream list
	const streams = [
		{
			name: 'DMM Cast TB✨',
			title: '🔗 Cast from DMM',
			externalUrl: `${baseUrl}/stremio-torbox/cast/${imdbid}`,
		},
		...userCasts.map((cast) => ({
			name: 'DMM Cast TB',
			title: `📺 ${cast.filename} (${cast.size}MB)\n🎬 DMM Cast TB (Yours)`,
			url: `${baseUrl}/api/stremio-tb/${userid}/play/${cast.hash}?file=${encodeURIComponent(cast.url)}`,
		})),
		...otherStreams.map((stream) => ({
			name: 'DMM Cast TB',
			title: `👥 ${stream.filename} (${stream.size}MB)\n🎬 DMM Cast TB`,
			url: `${baseUrl}/api/stremio-tb/${userid}/play/${stream.hash}?file=${encodeURIComponent(stream.url)}`,
		})),
	];

	res.json({ streams });
}
```

#### 3.5 Cast Operation Endpoints

**New Files:**

- `src/pages/api/stremio-tb/cast/movie/[imdbid].ts`
- `src/pages/api/stremio-tb/cast/series/[imdbid].ts`
- `src/pages/api/stremio-tb/cast/library/[torrentIdPlusHash].ts`
- `src/pages/api/stremio-tb/cast/saveProfile.ts`
- `src/pages/api/stremio-tb/cast/updateSizeLimits.ts`

#### 3.6 Link Management

**New Files:**

- `src/pages/api/stremio-tb/links.ts`
- `src/pages/api/stremio-tb/deletelink.ts`

---

### Phase 4: Frontend Pages

#### 4.1 Main Stremio TorBox Page

**New File:** `src/pages/stremio-torbox/index.tsx`

Key differences from RD version:

- Uses `useTorBoxCastToken()` hook
- Checks for `tb:apiKey` in localStorage
- Shows TorBox-specific branding and logo
- Links to TorBox login if not authenticated
- Different addon install URL: `/api/stremio-tb/{token}/manifest.json`

```tsx
export function StremioTorBoxPage() {
	const dmmCastToken = useTorBoxCastToken();
	const [hasTorBoxCredentials] = useState(() => {
		if (typeof window !== 'undefined') {
			return !!localStorage.getItem('tb:apiKey');
		}
		return false;
	});

	if (!hasTorBoxCredentials) {
		return (
			<div className="...">
				<AlertTriangle className="..." />
				<h1>TorBox Required</h1>
				<p>You must be logged in with TorBox to use this feature.</p>
				<Link href="/torbox/login">Login with TorBox</Link>
			</div>
		);
	}

	return (
		<div className="...">
			<Image src="https://static.debridmediamanager.com/dmmcast-torbox.png" alt="logo" />
			<h1 className="mb-4 text-2xl font-bold text-green-400">DMM Cast for TorBox</h1>

			{dmmCastToken && (
				<div>
					<Link href={`stremio://.../api/stremio-tb/${dmmCastToken}/manifest.json`}>
						Install
					</Link>
					<Link href={`https://web.stremio.com/#/addons?addon=...`}>Install (web)</Link>
				</div>
			)}

			<div className="instructions">
				<div>1. Choose a Movie or TV Show in DMM</div>
				<div>2. Select a Torrent &gt; Look Inside &gt; Cast (TB)</div>
				<div>3. Open the same content in Stremio</div>
				<div>4. Choose the DMM Cast TB✨ stream</div>
			</div>

			<Link href="/stremio-torbox/manage">Manage Casted Links</Link>
		</div>
	);
}
```

#### 4.2 Management Page

**New File:** `src/pages/stremio-torbox/manage.tsx`

Similar to `/stremio/manage.tsx` but:

- Uses TorBox API endpoints
- Uses TorBox database tables
- Different color scheme (green vs purple)

---

### Phase 5: Cast API Client

#### 5.1 TorBox Cast Client

**New File:** `src/utils/torboxCastApiClient.ts`

```typescript
export const handleCastMovieTorBox = async (
	imdbId: string,
	apiKey: string,
	hash: string
): Promise<{ success: boolean; filename?: string; error?: string }> => {
	const response = await fetch(
		`/api/stremio-tb/cast/movie/${imdbId}?apiKey=${apiKey}&hash=${hash}`
	);
	return response.json();
};

export const handleCastTvShowTorBox = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	fileIds: number[]
): Promise<{ success: boolean; results: any[]; errors: any[] }> => {
	// Batch processing similar to RD version
	// Process in batches of 5, 4 workers concurrent
};

export const saveTorBoxCastProfile = async (apiKey: string) => {
	await fetch('/api/stremio-tb/cast/saveProfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
	});
};
```

---

### Phase 6: Integration with Existing UI

#### 6.1 Add TorBox Cast Button to Movie/TV Pages

**Modify:** `src/pages/movie/[imdbid]/index.tsx`
**Modify:** `src/pages/show/[imdbid]/[seasonNum].tsx`

Add a second "Cast (TorBox)" button next to the existing RD Cast button:

```tsx
{
	hasTorBoxCredentials && (
		<button
			onClick={() => handleCastMovieTorBox(imdbId, apiKey, hash)}
			className="bg-green-600 hover:bg-green-700"
		>
			<Cast className="h-4 w-4" />
			Cast (TB)
		</button>
	);
}
```

#### 6.2 Settings Integration

**Modify:** `src/components/SettingsSection.tsx`

Add TorBox-specific size limit settings:

- `tb:movieMaxSize`
- `tb:episodeMaxSize`
- `tb:otherStreamsLimit`

---

### Phase 7: TorBox-Specific Optimizations

#### 7.1 DMM Playback Resolution and Cleanup Safety

Publish stable DMM play endpoints, for example:

```typescript
const playbackUrl = `${baseUrl}/api/stremio-tb/${userId}/play/${hash}?file=${encodeURIComponent(filename)}`;
```

The endpoint resolves or adds the torrent in the caller's TorBox account and requests a delivery URL with that caller's API key. Torrent and file IDs belong to an account; do not reuse another user's IDs or credential-bearing delivery URL. Sharing cast metadata (hash and filename) is distinct from sharing a TorBox URL.

TorBox `requestdl` and CDN URLs carry credentials. Repeated `requestdl` calls may return the same URL, but delivery URLs can become stale (including an “Invalid Presigned Token” refusal); they are not permanent links. Resolve again when needed rather than promising an expiry interval. `redirect=true` is only a redirect option, not a lifetime guarantee.

Before adding, take a complete paginated snapshot of existing torrent IDs. `createtorrent` can return the ID of an existing torrent, so a successful create response alone does not establish ownership for cleanup. Never delete an ID in the pre-add snapshot, or any torrent whose ownership could not be established because listing failed. Reuse and poll a held pending torrent instead of adding it again. Only a torrent proven new to this operation is eligible for temporary cleanup.

Gate playback on both `download_finished` and `download_present`. A finished but absent torrent is not playable, and a state string such as `stalled (no seeds)` does not override these flags.

The unified torrent library fetcher treats `success: false` on any torrent page as a failed refresh, not end-of-list. It must not cache the accumulated partial torrent list for five minutes; the next attempt starts at offset zero.

#### 7.2 Cached Check Optimization

Use TorBox's `checkcached` endpoint before adding torrents:

```typescript
const cachedStatus = await checkCachedStatus({ hash }, apiKey);
if (cachedStatus.data && cachedStatus.data[hash]) {
	// Torrent is cached, can be added instantly
	const torrent = await createTorrent(apiKey, { magnet: `magnet:?xt=urn:btih:${hash}` });
} else {
	// Torrent not cached, warn user
	throw new Error('Torrent not cached on TorBox');
}
```

#### 7.3 No File Selection Needed

Unlike Real-Debrid, TorBox doesn't require selecting files. All files are downloaded automatically. This simplifies the casting flow.

---

## File Structure Summary

```
src/
├── hooks/
│   └── torboxCastToken.ts              # NEW: TorBox cast token hook
├── pages/
│   ├── stremio-torbox/
│   │   ├── index.tsx                   # NEW: Main page
│   │   └── manage.tsx                  # NEW: Management page
│   └── api/
│       └── stremio-tb/
│           ├── id.ts                   # NEW: User ID generation
│           ├── links.ts                # NEW: Get all links
│           ├── deletelink.ts           # NEW: Delete link
│           ├── cast/
│           │   ├── movie/
│           │   │   └── [imdbid].ts     # NEW: Cast movie
│           │   ├── series/
│           │   │   └── [imdbid].ts     # NEW: Cast TV show
│           │   ├── library/
│           │   │   └── [torrentIdPlusHash].ts # NEW: Cast from library
│           │   ├── saveProfile.ts      # NEW: Save profile
│           │   └── updateSizeLimits.ts # NEW: Update settings
│           └── [userid]/
│               ├── manifest.json.ts    # NEW: Stremio manifest
│               ├── catalog/
│               │   ├── movie/
│               │   │   └── tb-casted-movies.json.ts
│               │   ├── series/
│               │   │   └── tb-casted-shows.json.ts
│               │   └── other/
│               │       ├── tb-casted-other.json.ts
│               │       └── tb-casted-other/
│               │           └── [skip].ts
│               ├── stream/
│               │   └── [mediaType]/
│               │       └── [imdbid].ts # NEW: Stream endpoint
│               ├── meta/
│               │   └── other/
│               │       └── [id].ts     # NEW: Meta endpoint
│               └── play/
│                   └── [link].ts       # NEW: Playback endpoint
├── services/
│   └── database/
│       └── torboxCast.ts               # NEW: TorBox cast DB service
└── utils/
    ├── getTorBoxStreamUrl.ts           # NEW: TorBox stream URL utility
    ├── torboxCastApiClient.ts          # NEW: Client-side cast functions
    └── torboxCastApiHelpers.ts         # NEW: User ID generation, validation
```

---

## Testing Plan

### Unit Tests

- `src/test/utils/getTorBoxStreamUrl.test.ts`
- `src/test/utils/torboxCastApiHelpers.test.ts`
- `src/test/services/database/torboxCast.test.ts`

### API Tests

- `src/test/api/stremio-tb/id.test.ts`
- `src/test/api/stremio-tb/cast/movie.test.ts`
- `src/test/api/stremio-tb/cast/series.test.ts`
- `src/test/api/stremio-tb/stream.test.ts`
- `src/test/api/stremio-tb/catalog.test.ts`

### Integration Tests

- End-to-end casting flow
- Stremio addon installation
- Stream playback

---

## UI/UX Branding

### Color Scheme

- **Real-Debrid**: Purple/Violet (`purple-500`, `purple-800`)
- **TorBox**: Green/Emerald (`green-500`, `green-800`, `emerald-400`)
- **AllDebrid**: Orange/Amber (`orange-500`, `orange-800`, `amber-400`)

### Icons & Logos

- Create new logo: `dmmcast-torbox.png`
- Use green cast icon for TorBox buttons
- TorBox branding in addon manifest

### Navigation

Add TorBox Cast option to:

- Home page navigation
- Settings dropdown
- Footer links

---

## Environment Variables

Add to `.env.local`:

```bash
# Existing
DMMCAST_SALT=...

# No additional TorBox-specific env vars needed
# TorBox API key is stored per-user in localStorage and database
```

---

## Migration Considerations

### For Existing Users

- No migration needed - completely separate system
- Users with both RD and TorBox can use both addons simultaneously

### Database

- New tables are independent
- No impact on existing `Cast` and `CastProfile` tables

---

## Security Considerations

### API Key Storage

- TorBox API key stored in localStorage (client) and encrypted in database (server)
- Never expose API key in URLs visible to other users
- Use user ID hash for all public-facing endpoints

### Playback URL and Error Security

- Stable DMM play endpoints resolve with the caller's credentials; do not publish a stored TorBox delivery URL as a shared stream.
- TorBox `requestdl` and CDN URLs contain the API key and must be treated as full-account credentials, not public permalinks.
- Never log credential-bearing URLs, API keys, raw Axios errors/configuration, or arbitrary provider response messages.
- Error reporting uses fixed operation labels and sanitized status/allowlisted error codes; a provider's HTTP 500 message can contain sensitive data too.

---

## Implementation Order

1. **Week 1**: Database schema, core services
    - Add Prisma models
    - Create TorBoxCastService
    - Create TorBox stream URL utilities

2. **Week 2**: API routes
    - User ID generation
    - Profile management
    - Cast endpoints (movie, series)

3. **Week 3**: Stremio addon
    - Manifest
    - Catalog endpoints
    - Stream endpoint

4. **Week 4**: Frontend
    - Stremio TorBox page
    - Management page
    - Integration with movie/TV pages

5. **Week 5**: Testing & polish
    - Write tests
    - Fix bugs
    - Documentation

---

## Summary

This plan creates a complete "DMM Cast for TorBox" feature that:

1. **Maintains Separation**: Uses separate URL paths (`/stremio-tb`), database tables, and localStorage keys
2. **Preserves Existing URLs**: Real-Debrid addon URLs remain unchanged at `/api/stremio/[userid]/...`
3. **Resolves Playback for the Caller**: Uses stable DMM play endpoints rather than sharing permanent TorBox URLs
4. **Follows Existing Patterns**: Mirrors the RD implementation architecture for consistency
5. **Provides Clear Branding**: Distinct visual identity (green theme) to differentiate from RD version
6. **Enables Dual Use**: Users can install and use both addons simultaneously

The implementation reuses the proven DMM Cast architecture while adapting to TorBox's simpler authentication model and API differences.
