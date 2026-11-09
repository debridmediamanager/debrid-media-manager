-- Releases sponsors' zurg asked DMM to place (POST /api/sponsor/place) that it could not place,
-- kept to improve the rules. Additive only: one new table. Apply before deploying the code that
-- writes it.

-- CreateTable
CREATE TABLE `PlacementMiss` (
    `id` CHAR(40) NOT NULL,
    `hash` VARCHAR(40) NULL,
    `name` VARCHAR(1024) NOT NULL,
    `kind` VARCHAR(8) NULL,
    `imdbId` VARCHAR(16) NULL,
    `tmdbId` INTEGER NULL,
    `fileCount` INTEGER NOT NULL,
    `files` JSON NOT NULL,
    `rules` VARCHAR(16) NOT NULL,
    `asks` INTEGER NOT NULL DEFAULT 1,
    `firstSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlacementMiss_lastSeen_idx`(`lastSeen`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
