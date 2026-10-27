ALTER TABLE `subtitle_requests` ADD `hits` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `subtitle_requests` ADD `last_seen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subtitle_requests` ADD `duplicate_of` text;