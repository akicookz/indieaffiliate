CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`name` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_project` ON `api_keys` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_keys_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `stripe_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`last_sync_at` integer,
	`last_sync_cursor` text,
	`sync_status` text DEFAULT 'idle' NOT NULL,
	`sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_connections_project_id_unique` ON `stripe_connections` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stripe_connections_project` ON `stripe_connections` (`project_id`);--> statement-breakpoint
CREATE TABLE `sync_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_logs_project` ON `sync_logs` (`project_id`);