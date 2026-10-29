-- A Trakt or MDBList list a sponsor follows; the cron adds its new titles to WantedItem.
-- Additive only. Apply before deploying the code that reads it.
CREATE TABLE `WantedList` (
    `id` VARCHAR(191) NOT NULL,
    `shortId` VARCHAR(16) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `name` VARCHAR(512) NOT NULL,
    `seen` JSON NOT NULL,
    `added` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `syncedAt` DATETIME(3) NULL,
    `error` VARCHAR(512) NULL,

    UNIQUE INDEX `WantedList_shortId_url_key`(`shortId`, `url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
