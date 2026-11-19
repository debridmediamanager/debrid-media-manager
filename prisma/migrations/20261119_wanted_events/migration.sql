-- The history a sponsor's zurg reports for each wanted title (POST /api/sponsor/wanted/history),
-- the NZBs zurgs uploaded for one another (PUT /api/sponsor/wanted/nzb/<sha>), and a show's
-- have/missing snapshot. Additive only: one nullable column and two new tables. Apply before
-- deploying the code that reads them, since the website's wanted list selects `progress`.

-- AlterTable
ALTER TABLE `WantedItem` ADD COLUMN `progress` JSON NULL;

-- CreateTable
-- `key` is utf8mb4_bin: its alphabet is mixed-case, and under the table's case-insensitive
-- collation the unique key would take `a1` and `A1` for one event and drop the second.
CREATE TABLE `WantedEvent` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `itemId` CHAR(36) NOT NULL,
    `shortId` VARCHAR(16) NOT NULL,
    `imdbId` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `key` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `reason` VARCHAR(24) NOT NULL,
    `detail` VARCHAR(300) NOT NULL,
    `release` VARCHAR(512) NOT NULL,
    `torrent` BOOLEAN NOT NULL,
    `hash` CHAR(40) NULL,
    `nzb` CHAR(64) NULL,
    `dmmId` VARCHAR(255) NULL,
    `size` BIGINT NULL,
    `posted` DATETIME(3) NULL,
    `season` INTEGER NULL,
    `episode` INTEGER NULL,
    `pack` BOOLEAN NOT NULL DEFAULT false,
    `resolution` VARCHAR(8) NOT NULL,
    `shared` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WantedEvent_itemId_at_idx`(`itemId`, `at`),
    INDEX `WantedEvent_imdbId_shared_idx`(`imdbId`, `shared`),
    INDEX `WantedEvent_nzb_idx`(`nzb`),
    INDEX `WantedEvent_shared_createdAt_idx`(`shared`, `createdAt`),
    UNIQUE INDEX `WantedEvent_itemId_key_key`(`itemId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WantedNzb` (
    `sha` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`sha`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
