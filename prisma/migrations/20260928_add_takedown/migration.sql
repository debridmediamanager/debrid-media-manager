-- Notice-and-takedown. Additive only.
CREATE TABLE `TakedownNotice` (
    `id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `claimantName` VARCHAR(200) NOT NULL,
    `claimantEmail` VARCHAR(320) NOT NULL,
    `representing` VARCHAR(200) NULL,
    `work` TEXT NOT NULL,
    `reason` TEXT NOT NULL,
    `locations` MEDIUMTEXT NOT NULL,
    `hashes` JSON NOT NULL,
    `releases` JSON NOT NULL,
    `hashlistIds` JSON NOT NULL,
    `submitterIp` VARCHAR(64) NULL,
    `reviewNote` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TakedownNotice_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BlockedHash` (
    `hash` VARCHAR(40) NOT NULL,
    `noticeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BlockedHash_noticeId_idx`(`noticeId`),
    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BlockedRelease` (
    `name` VARCHAR(191) NOT NULL,
    `noticeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BlockedRelease_noticeId_idx`(`noticeId`),
    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
