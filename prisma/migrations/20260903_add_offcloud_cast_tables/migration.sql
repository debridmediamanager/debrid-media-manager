-- CreateTable: OffcloudCast
--
-- No `link` column, deliberately - the same reasoning as PremiumizeCast, and
-- for the same storage: Offcloud's cached-torrent backend is measured to be
-- Premiumize's, serving the identical energycdn objects. `POST /api/cloud` is
-- idempotent by hash and answers `downloaded` synchronously for cached
-- content, so the viewer resolves hash -> signed links with their own key at
-- play time. A stored energycdn URL would also carry the caster's
-- account-scoped token, which is exactly what must not be shared. `path` is
-- the file's path inside the release, which is how the play route finds the
-- same file again.
CREATE TABLE `OffcloudCast` (
    `id` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `path` TEXT NULL,

    UNIQUE INDEX `OffcloudCast_imdbId_userId_hash_key`(`imdbId`, `userId`, `hash`),
    INDEX `OffcloudCast_imdbId_userId_updatedAt_idx`(`imdbId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: OffcloudCastProfile
CREATE TABLE `OffcloudCastProfile` (
    `userId` VARCHAR(191) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `movieMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `episodeMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `otherStreamsLimit` INTEGER NOT NULL DEFAULT 5,
    `hideCastOption` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
