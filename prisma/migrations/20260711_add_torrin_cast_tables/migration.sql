-- CreateTable
CREATE TABLE `TorrinCast` (
    `id` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `link` TEXT NULL,

    INDEX `TorrinCast_imdbId_userId_updatedAt_idx`(`imdbId`, `userId`, `updatedAt`),
    UNIQUE INDEX `TorrinCast_imdbId_userId_hash_key`(`imdbId`, `userId`, `hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TorrinCastProfile` (
    `userId` VARCHAR(191) NOT NULL,
    `baseUrl` TEXT NOT NULL,
    `apiKey` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `movieMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `episodeMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `otherStreamsLimit` INTEGER NOT NULL DEFAULT 5,
    `hideCastOption` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
