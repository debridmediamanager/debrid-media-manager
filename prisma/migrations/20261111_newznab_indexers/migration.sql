-- The Newznab aggregator's upstream indexers, moved out of the NEWZNAB_INDEXERS env var so
-- /newznab/admin can edit them without a redeploy. Additive only: one new table. While it is
-- empty the env var still applies, so the code can deploy before or after the rows exist.

-- CreateTable
CREATE TABLE `NewznabIndexer` (
    `prefix` VARCHAR(16) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `apiKey` VARCHAR(255) NOT NULL DEFAULT '',
    `keyless` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `pacingRate` INTEGER NULL,
    `pacingWindow` INTEGER NULL,
    `grabRate` INTEGER NULL,
    `grabWindow` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`prefix`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
