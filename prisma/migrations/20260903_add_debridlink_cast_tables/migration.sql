-- CreateTable: DebridLinkCast
--
-- Shaped like `OffcloudCast` and `PremiumizeCast` - a hash and a file path, so
-- the viewer resolves the release with their own credential at play time.
-- `POST /seedbox/add` is idempotent by hash and the torrent id it returns is
-- stable across duplicate adds and even across remove/re-add, so there is
-- nothing here that can rot and nothing that has to be re-minted into the row.
--
-- One column has no counterpart in the sibling tables: `downloadUrl`. A
-- Debrid-Link URL carries no token, no signature, no timestamp and no user id -
-- the torrent id is the entire capability - it serves any IP, and it keeps
-- serving after the torrent is deleted (measured 2026-09-02,
-- docs/providers/debrid-link.md section 7). That makes a stored one a real
-- fallback for the case the other providers cannot cover: a viewer whose own
-- credential cannot resolve the hash because the daily 50-torrent quota is
-- spent, because an endpoint is inside its hour-long `floodDetected` lockout,
-- or because their token died. It is nullable because a resolve is allowed to
-- produce no URL, and because a row written before this column existed must
-- keep playing.
--
-- The flip side is deliberate and has to stay understood: this value is an
-- irrevocable, unauthenticated capability to the content. Only the play route
-- reads it, only to issue a redirect; it is never logged, never returned to a
-- client and never included in the `links` listing the manage page reads.
CREATE TABLE `DebridLinkCast` (
    `id` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `path` TEXT NULL,
    `downloadUrl` TEXT NULL,

    UNIQUE INDEX `DebridLinkCast_imdbId_userId_hash_key`(`imdbId`, `userId`, `hash`),
    INDEX `DebridLinkCast_imdbId_userId_updatedAt_idx`(`imdbId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: DebridLinkCastProfile
--
-- `apiKey` holds whatever `useDebridLinkCredential` returned at enrol: an OAuth
-- access token from the device-code login, or a token pasted from the account
-- page. Both authenticate through the same `Authorization: Bearer` header, so
-- nothing downstream needs to tell them apart.
--
-- `refreshToken` is nullable and is written only when the browser actually holds
-- one, which means only for a device-flow login. It exists now rather than in a
-- later migration because Debrid-Link's real `expires_in` has not been measured
-- yet: plex_debrid never refreshes and keeps working, which hints at a
-- Premiumize-style decade-long token but proves nothing. If the token turns out
-- to be long-lived the column simply stays unread; if it turns out to last days,
-- the schema is already in place and only the refresh call has to be added.
-- Adding a nullable column now is one cheap ALTER against a production database
-- where `prisma migrate deploy` is known broken (see dmm/CLAUDE.md), which is
-- exactly the migration worth not needing twice.
CREATE TABLE `DebridLinkCastProfile` (
    `userId` VARCHAR(191) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `refreshToken` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `movieMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `episodeMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `otherStreamsLimit` INTEGER NOT NULL DEFAULT 5,
    `hideCastOption` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
