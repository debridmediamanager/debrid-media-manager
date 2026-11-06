-- Probes sponsors' apps send for single files of a torrent (POST /api/sponsor/probes), answered by
-- /api/sponsor/mediainfo after zurg's own snapshots. Additive only: one new table. Apply before
-- deploying the code that reads and writes it.

-- CreateTable
CREATE TABLE `ContributedProbe` (
    `hash` VARCHAR(40) NOT NULL,
    `bytes` BIGINT NOT NULL,
    `name` VARCHAR(512) NULL,
    `mediaInfo` JSON NOT NULL,
    `sponsor` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`hash`, `bytes`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
