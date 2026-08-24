-- CreateTable: PremiumizeCast
--
-- No `link` column, deliberately. `transfer/directdl` resolves a cached hash to
-- signed CDN links in one stateless call, so every viewer mints their own at
-- play time - which is also the only correct billing: Premiumize charges the
-- minting account's fair-use pool. `path` is the file's path inside the release,
-- which is how the play route finds the same file again.
CREATE TABLE `PremiumizeCast` (
    `id` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `path` TEXT NULL,

    UNIQUE INDEX `PremiumizeCast_imdbId_userId_hash_key`(`imdbId`, `userId`, `hash`),
    INDEX `PremiumizeCast_imdbId_userId_updatedAt_idx`(`imdbId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: PremiumizeCastProfile
CREATE TABLE `PremiumizeCastProfile` (
    `userId` VARCHAR(191) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `movieMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `episodeMaxSize` DOUBLE NOT NULL DEFAULT 0,
    `otherStreamsLimit` INTEGER NOT NULL DEFAULT 5,
    `hideCastOption` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
