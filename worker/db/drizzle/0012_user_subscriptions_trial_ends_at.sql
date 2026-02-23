-- Create user_subscriptions if it doesn't exist (table was never in an earlier migration).
-- Includes trial_ends_at so we don't need a separate ALTER for new DBs.
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
CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_subscriptions_user` ON `user_subscriptions` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_subscriptions_stripe_customer` ON `user_subscriptions` (`stripe_customer_id`);
