-- Which sponsorship let a cast profile store an "other streams" limit above 5.
-- Additive only. Apply before deploying the code that reads it.
CREATE TABLE `CastSponsorGrant` (
    `service` VARCHAR(4) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `shortId` VARCHAR(16) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`service`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
