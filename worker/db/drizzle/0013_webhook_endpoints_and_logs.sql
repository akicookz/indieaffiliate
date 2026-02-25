-- Webhook tables were initially created in 0012_flimsy_jigsaw.sql.
-- Keep this migration idempotent in case both run.
CREATE TABLE IF NOT EXISTS `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_endpoints_project` ON `webhook_endpoints` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_endpoints_active` ON `webhook_endpoints` (`project_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status_code` integer,
	`response_body` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_logs_endpoint` ON `webhook_logs` (`endpoint_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_logs_endpoint_created` ON `webhook_logs` (`endpoint_id`,`created_at`);
