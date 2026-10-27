CREATE INDEX `configs_created_idx` ON `configs` (`created`);--> statement-breakpoint
CREATE INDEX `counters_expires_idx` ON `counters` (`expires`);--> statement-breakpoint
CREATE INDEX `jobs_expires_idx` ON `jobs` (`expires`);--> statement-breakpoint
CREATE INDEX `lookups_expires_idx` ON `lookups` (`expires`);