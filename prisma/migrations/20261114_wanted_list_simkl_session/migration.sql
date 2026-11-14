-- A followed Simkl list keeps the follower's DMM Simkl sign-in, the only way Simkl lets it be read.
-- Additive only. Apply before deploying the code that reads it.
ALTER TABLE `WantedList` ADD COLUMN `simklSession` VARCHAR(64) NULL;
