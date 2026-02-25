-- Legacy migration: user_subscriptions + webhooks.
-- Use IF NOT EXISTS everywhere so this migration is idempotent across environments.
CREATE TABLE IF NOT EXISTS `user_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_end` integer,
	`trial_ends_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_subscriptions_user_id_unique` ON `user_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_subscriptions_user` ON `user_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_subscriptions_stripe_customer` ON `user_subscriptions` (`stripe_customer_id`);--> statement-breakpoint
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
CREATE INDEX IF NOT EXISTS `idx_webhook_endpoints_project` ON `webhook_endpoints` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_endpoints_active` ON `webhook_endpoints` (`project_id`,`is_active`);--> statement-breakpoint
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
CREATE INDEX IF NOT EXISTS `idx_webhook_logs_endpoint` ON `webhook_logs` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_logs_endpoint_created` ON `webhook_logs` (`endpoint_id`,`created_at`);