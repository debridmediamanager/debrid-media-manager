-- CreateTable: ContentRequest (the request board — RD-only users ask, TB/AD users fulfil)
--
-- `hash` + `requesterId` is unique so re-asking for a release is idle rather
-- than a second row; the status/createdAt index serves the board itself, which
-- reads open and failed rows oldest-first.
CREATE TABLE `ContentRequest` (
    `id` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(191) NOT NULL,
    `title` TEXT NULL,
    `mediaType` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `fulfillerId` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `jobHost` TEXT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ContentRequest_requesterId_status_idx`(`requesterId`, `status`),
    INDEX `ContentRequest_imdbId_idx`(`imdbId`),
    UNIQUE INDEX `ContentRequest_hash_requesterId_key`(`hash`, `requesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
