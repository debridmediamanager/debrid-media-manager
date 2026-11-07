-- CreateTable: EasynewsCast
--
-- No link column: Easynews signs a fresh link on every request, so the play route
-- asks for one with the viewer's own login. `path` is `{hash}{ext}/{name}{ext}`,
-- what that request names.
CREATE TABLE `EasynewsCast` (
    `id` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `path` TEXT NOT NULL,

    UNIQUE INDEX `EasynewsCast_imdbId_userId_hash_key`(`imdbId`, `userId`, `hash`),
    INDEX `EasynewsCast_imdbId_userId_updatedAt_idx`(`imdbId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: EasynewsCastProfile
CREATE TABLE `EasynewsCastProfile` (
    `userId` VARCHAR(191) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `movieMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `episodeMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `otherStreamsLimit` INTEGER NOT NULL DEFAULT 5,
    `hideCastOption` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
