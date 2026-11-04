-- AlterTable
ALTER TABLE `ContentRequest`
    ADD COLUMN `tries` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `tbUnservableUntil` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `ContentRequestAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `fulfillerId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `jobHost` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'sending',
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    INDEX `ContentRequestAttempt_fulfillerId_createdAt_idx`(`fulfillerId`, `createdAt`),
    INDEX `ContentRequestAttempt_requestId_jobId_idx`(`requestId`, `jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
