-- What zurg said it took when it acknowledged a wanted title, and the resolution
-- it still wants, which keeps a fetched film on the list zurg reads.
-- Additive only. Apply before deploying the code that reads it.
ALTER TABLE `WantedItem` ADD COLUMN `fulfilled` JSON NULL;
