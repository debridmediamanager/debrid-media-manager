-- Data only: requests used to be marked `fulfilled` when their transfer was
-- queued, not when it landed. Put every one that has a job back to `claimed`
-- so the cron's request sweep asks the uploader how it actually ended: a
-- completed job settles it as `fulfilled` again, a failed one returns it to
-- the board with the uploader's reason.
UPDATE `ContentRequest` SET `status` = 'claimed' WHERE `status` = 'fulfilled' AND `jobId` IS NOT NULL;
