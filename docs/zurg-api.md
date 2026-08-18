# Zurg API Documentation

This document describes the Zurg API endpoints for hash-based torrent search and API key management.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Database Schema](#database-schema)
- [Endpoints](#endpoints)
    - [Register API Key](#register-api-key)
    - [Get Hashes by IMDB ID](#get-hashes-by-imdb-id)
- [Usage Examples](#usage-examples)
- [Migration](#migration)

---

## Overview

The Zurg API provides two main functionalities:

1. **API Key Registration**: Create time-limited API keys for accessing the Zurg endpoints
2. **Hash Search**: Search for torrent hashes by IMDB ID with advanced filtering options

---

## Authentication

### Two Authentication Methods

#### 1. Admin Authentication (for API Key Registration)

- **Header**: `Authorization`
- **Value**: Must match the `DMMCAST_SALT` environment variable
- **Used for**: `/api/zurg/register-api-key` endpoint only
- **Security**: This is an admin-only operation

#### 2. API Key Authentication (for Hash Search)

- **Header**: `x-api-key`
- **Value**: API key obtained from the registration endpoint
- **Used for**: `/api/zurg/hashes-by-imdb` endpoint
- **Validation**: Checks if key exists and is not expired

---

## Database Schema

### ZurgKeys Table

```sql
CREATE TABLE `ZurgKeys` (
    `apiKey` VARCHAR(191) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ZurgKeys_validUntil_idx`(`validUntil`),
    PRIMARY KEY (`apiKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Columns:**

- `apiKey` (VARCHAR, Primary Key): 64-character hex string (256-bit entropy)
- `validUntil` (DATETIME): Expiration timestamp for the key
- `createdAt` (DATETIME): Creation timestamp

**Indexes:**

- Primary key on `apiKey`
- Index on `validUntil` for efficient expiration checks

---

## Endpoints

### Register API Key

Creates a new API key with configurable expiration.

**Endpoint**: `POST /api/zurg/register-api-key`

**Authentication**: Requires `DMMCAST_SALT` environment variable in `Authorization` header

**Request Headers:**

```
Authorization: <DMMCAST_SALT value>
Content-Type: application/json
```

**Request Body:**

```json
{
	"validForDays": 90 // Optional, default: 30, max: 365
}
```

**Response (200 OK):**

```json
{
	"apiKey": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
	"createdAt": "2024-12-02T00:00:00.000Z",
	"expiresInDays": 90,
	"validUntil": "2025-03-02T00:00:00.000Z"
}
```

**Error Responses:**

| Status | Error                                             | Description                                     |
| ------ | ------------------------------------------------- | ----------------------------------------------- |
| 401    | `Missing Authorization header`                    | No Authorization header provided                |
| 401    | `Invalid authorization`                           | Authorization header doesn't match DMMCAST_SALT |
| 400    | `validForDays must be a number between 1 and 365` | Invalid validity period                         |
| 405    | `Method not allowed`                              | Non-POST request                                |
| 500    | `Server configuration error`                      | DMMCAST_SALT not set in environment             |

---

### Get Hashes by IMDB ID

Search for torrent hashes by IMDB ID with advanced filtering.

**Endpoint**: `POST /api/zurg/hashes-by-imdb`

**Authentication**: Requires valid API key in `x-api-key` header

**Request Headers:**

```
x-api-key: <your-api-key>
Content-Type: application/json
```

**Request Body:**

```json
{
	"imdbId": "tt1234567",
	"limit": 10, // Optional: max results, default: 5, max: 100
	"sizeFilters": {
		"min": 5, // Optional: minimum size in GB (inclusive)
		"max": 50 // Optional: maximum size in GB (inclusive)
	},
	"substringFilters": {
		"blacklist": ["CAM", "TS", "HDCAM"], // Optional: exclude these substrings
		"whitelist": ["1080p", "BluRay", "WEB-DL"] // Optional: only include these substrings
	}
}
```

**Filter Logic:**

1. **Size Filters** (both optional):
    - `min`: Include only files >= this size (in GB)
    - `max`: Include only files <= this size (in GB)
    - Can use both for a range: `min <= size <= max`

2. **Substring Filters** (both optional):
    - **Blacklist** (checked first): Excludes results if filename contains ANY blacklisted substring
    - **Whitelist** (checked second): Includes ONLY results if filename contains ANY whitelisted substring
    - Case-insensitive matching
    - Can combine both: whitelist first, then remove blacklisted

3. **Query Priority**:
    - Searches `Available` table first (downloaded torrents)
    - Then searches `Cast` table (user casts from last 30 days)
    - Finally searches `Scraped` table (scraped torrent data)
    - Stops when limit is reached

**Response (200 OK):**

```json
{
	"count": 2,
	"hashes": [
		{
			"hash": "abc123def456...",
			"source": "available",
			"filename": "Movie.2024.1080p.BluRay.x264.mkv",
			"size": 10737418240,
			"sizeGB": 10,
			"imdbId": "tt1234567"
		},
		{
			"hash": "xyz789uvw012...",
			"source": "cast",
			"filename": "Movie.2024.720p.WEB-DL.mp4",
			"size": 5368709120,
			"sizeGB": 5,
			"imdbId": "tt1234567"
		}
	],
	"sources": {
		"available": 1,
		"cast": 1,
		"scraped": 0
	}
}
```

**Error Responses:**

| Status | Error                                                                   | Description                           |
| ------ | ----------------------------------------------------------------------- | ------------------------------------- |
| 401    | `Missing x-api-key header`                                              | No API key provided                   |
| 401    | `Invalid or expired API key`                                            | API key doesn't exist or is expired   |
| 400    | `Invalid IMDB ID format`                                                | IMDB ID doesn't match `tt\d+` pattern |
| 400    | `Limit must be a number between 1 and 100`                              | Invalid limit value                   |
| 400    | `sizeFilters.min cannot be greater than sizeFilters.max`                | Invalid size range                    |
| 400    | `substringFilters must contain at least one of: blacklist or whitelist` | Empty substringFilters object         |
| 405    | `Method not allowed`                                                    | Non-POST request                      |

---

## Usage Examples

### Example 1: Register an API Key

```bash
curl -X POST http://localhost:3000/api/zurg/register-api-key \
  -H "Content-Type: application/json" \
  -H "Authorization: your-dmmcast-salt-value" \
  -d '{
    "validForDays": 90
  }'
```

**Response:**

```json
{
	"apiKey": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
	"createdAt": "2024-12-02T12:34:56.789Z",
	"expiresInDays": 90,
	"validUntil": "2025-03-02T12:34:56.789Z"
}
```

### Example 2: Basic Hash Search

```bash
curl -X POST http://localhost:3000/api/zurg/hashes-by-imdb \
  -H "Content-Type: application/json" \
  -H "x-api-key: a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456" \
  -d '{
    "imdbId": "tt1234567"
  }'
```

### Example 3: Hash Search with Size Filter

```bash
curl -X POST http://localhost:3000/api/zurg/hashes-by-imdb \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "imdbId": "tt1234567",
    "sizeFilters": {
      "min": 10,
      "max": 50
    },
    "limit": 10
  }'
```

### Example 4: Hash Search with Blacklist

```bash
curl -X POST http://localhost:3000/api/zurg/hashes-by-imdb \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "imdbId": "tt1234567",
    "substringFilters": {
      "blacklist": ["CAM", "TS", "HDCAM", "TELESYNC"]
    }
  }'
```

### Example 5: Hash Search with Whitelist

```bash
curl -X POST http://localhost:3000/api/zurg/hashes-by-imdb \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "imdbId": "tt1234567",
    "substringFilters": {
      "whitelist": ["1080p", "BluRay", "WEB-DL"]
    }
  }'
```

### Example 6: Combined Filters

```bash
curl -X POST http://localhost:3000/api/zurg/hashes-by-imdb \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "imdbId": "tt1234567",
    "sizeFilters": {
      "min": 5,
      "max": 50
    },
    "substringFilters": {
      "blacklist": ["CAM", "TS"],
      "whitelist": ["1080p", "BluRay"]
    },
    "limit": 10
  }'
```

This will return torrents that:

- Are between 5GB and 50GB
- Don't contain "CAM" or "TS" in the filename
- Must contain "1080p" or "BluRay" in the filename
- Return up to 10 results

---

## Migration

### Running the Migration

The migration SQL file is located at `/prisma/migrations/add_zurg_keys_table.sql`.

**To apply the migration manually:**

```sql
CREATE TABLE `ZurgKeys` (
    `apiKey` VARCHAR(191) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ZurgKeys_validUntil_idx`(`validUntil`),
    PRIMARY KEY (`apiKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Or using Prisma (when database credentials are configured):**

```bash
npx prisma migrate deploy
```

### Verifying the Migration

```sql
-- Check if table exists
SHOW TABLES LIKE 'ZurgKeys';

-- View table structure
DESCRIBE ZurgKeys;

-- Check indexes
SHOW INDEX FROM ZurgKeys;
```

---

## Maintenance

### Cleanup Expired Keys

The `ZurgKeysService` provides a method to delete expired keys:

```typescript
import { repository as db } from '@/services/repository';

// Delete all expired keys
const deletedCount = await db.deleteExpiredZurgKeys();
console.log(`Deleted ${deletedCount} expired keys`);
```

**Recommended**: Set up a cron job to run this cleanup periodically (e.g., daily).

### List All Keys

```typescript
import { repository as db } from '@/services/repository';

const keys = await db.listZurgApiKeys();
keys.forEach((key) => {
	console.log(`Key: ${key.apiKey}`);
	console.log(`Valid Until: ${key.validUntil}`);
	console.log(`Expired: ${key.isExpired}`);
});
```

---

## Security Considerations

1. **DMMCAST_SALT Protection**:
    - Keep the `DMMCAST_SALT` environment variable secret
    - Only share with trusted administrators
    - Rotate periodically

2. **API Key Storage**:
    - API keys are stored in plain text in the database
    - They are 64-character random hex strings (256-bit entropy)
    - Treat them as sensitive credentials

3. **Expiration**:
    - Always set reasonable expiration periods
    - Maximum 365 days
    - Recommended: 30-90 days for regular use

4. **Rate Limiting**:
    - Consider implementing rate limiting on the hash search endpoint
    - Monitor for abuse

---

## Support

For issues or questions:

- Check the test files: `/src/test/api/zurg/*.test.ts`
- Review the service implementation: `/src/services/database/zurgKeys.ts`
- Check the endpoint handlers: `/src/pages/api/zurg/*.ts`
