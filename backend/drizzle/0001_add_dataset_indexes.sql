CREATE INDEX IF NOT EXISTS `datasets_type_idx` ON `datasets` (`type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `datasets_seller_wallet_idx` ON `datasets` (`seller_wallet`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `datasets_created_at_idx` ON `datasets` (`created_at`);
