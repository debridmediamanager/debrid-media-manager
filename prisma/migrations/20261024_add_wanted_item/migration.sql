-- A sponsor's wanted list, which their zurg reads from /api/sponsor/wanted.
-- Additive only. Apply before deploying the code that reads it.
CREATE TABLE `WantedItem` (
    `id` VARCHAR(191) NOT NULL,
    `shortId` VARCHAR(16) NOT NULL,
    `imdbId` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `seasons` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fulfilledAt` DATETIME(3) NULL,
    `lastPolledAt` DATETIME(3) NULL,

    UNIQUE INDEX `WantedItem_shortId_imdbId_key`(`shortId`, `imdbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

