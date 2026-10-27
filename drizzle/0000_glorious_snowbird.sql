CREATE TABLE `configs` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`email` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`id` text PRIMARY KEY NOT NULL,
	`used` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`target` text NOT NULL,
	`email` text NOT NULL,
	`data` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_cache_key_unique` ON `jobs` (`cache_key`);--> statement-breakpoint
CREATE TABLE `lookups` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`expires` integer NOT NULL
);
