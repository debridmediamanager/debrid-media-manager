-- gets the total number of torrents scraped by DMM
SELECT SUM(JSON_LENGTH(Scraped.value)) AS total_torrents FROM Scraped;
