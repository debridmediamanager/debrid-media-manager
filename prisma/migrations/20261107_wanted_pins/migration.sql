-- Releases a sponsor picked for their zurg with "Send to zurg" (an Easynews result's
-- NZB, stored under the `en` prefix). Additive only: one nullable column. Apply before
-- deploying the code that reads it, since every wanted-list read selects it.
ALTER TABLE `WantedItem` ADD COLUMN `pins` JSON NULL;
