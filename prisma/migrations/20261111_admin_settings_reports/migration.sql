-- /admin grows: the title-page Usenet search reads its indexers from NewznabIndexer
-- (`mediaPage`), a few site settings move out of the environment (SiteSetting, where a
-- missing row means the env var still applies), and reports wait for an admin decision
-- (ReportDecision) instead of hiding a release on their own. Additive only.

-- AlterTable
ALTER TABLE `NewznabIndexer` ADD COLUMN `mediaPage` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `SiteSetting` (
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportDecision` (
    `imdbId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `decision` VARCHAR(16) NOT NULL,
    `note` TEXT NULL,
    `decidedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportDecision_decision_decidedAt_idx`(`decision`, `decidedAt`),
    PRIMARY KEY (`imdbId`, `hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
