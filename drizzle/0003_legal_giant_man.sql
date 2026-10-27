CREATE TABLE `subtitle_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`target` text NOT NULL,
	`origin` text NOT NULL,
	`filename` text NOT NULL,
	`release` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`job_id` text,
	`error_code` text,
	`message` text,
	`duration_ms` integer,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subtitle_requests_created_idx` ON `subtitle_requests` (`created`,`id`);--> statement-breakpoint
CREATE INDEX `subtitle_requests_job_idx` ON `subtitle_requests` (`job_id`);--> statement-breakpoint
CREATE INDEX `subtitle_requests_expires_idx` ON `subtitle_requests` (`expires`);