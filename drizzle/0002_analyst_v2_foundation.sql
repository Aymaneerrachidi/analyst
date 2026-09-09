CREATE TABLE "alert_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"guest_id" text NOT NULL,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"token" text,
	"trader" text,
	"threshold" double precision,
	"enabled" boolean DEFAULT true NOT NULL,
	"destination" text DEFAULT 'browser' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"number" bigint NOT NULL,
	"hash" text NOT NULL,
	"parent_hash" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"start_block" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"ws_status" text DEFAULT 'disconnected' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"quote_address" text NOT NULL,
	"side" text NOT NULL,
	"amount_token" text NOT NULL,
	"amount_quote" text NOT NULL,
	"usd_value" double precision,
	"execution_price" double precision,
	"dex" text NOT NULL,
	"pool_address" text NOT NULL,
	"attribution" text DEFAULT 'transaction initiator' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"token_address" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_raw" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidity_pools" (
	"address" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 4663 NOT NULL,
	"token0" text NOT NULL,
	"token1" text NOT NULL,
	"dex" text NOT NULL,
	"kind" text NOT NULL,
	"fee" integer,
	"factory" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"code_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_address" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price_usd" double precision,
	"market_cap" double precision,
	"fdv" double precision,
	"liquidity_usd" double precision,
	"volume_5m" double precision,
	"volume_1h" double precision,
	"volume_6h" double precision,
	"volume_24h" double precision,
	"buys_5m" integer,
	"sells_5m" integer,
	"buyers_5m" integer,
	"sellers_5m" integer,
	"holder_count" integer,
	"price_change_5m" double precision,
	"price_change_1h" double precision,
	"source" text NOT NULL,
	"completeness" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_chain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"contract" text NOT NULL,
	"topics" jsonb NOT NULL,
	"raw_data" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"ingestion_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"overall_risk" text NOT NULL,
	"score" double precision,
	"sell_simulation" text DEFAULT 'UNKNOWN' NOT NULL,
	"owner_permissions" jsonb,
	"mint_permissions" text,
	"blacklist_possible" text,
	"pause_possible" text,
	"holder_concentration" double precision,
	"creator_holdings" double precision,
	"related_wallet_concentration" double precision,
	"liquidity_risk" text,
	"suspicious_creator_activity" jsonb,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"signal_id" text PRIMARY KEY NOT NULL,
	"return_5m" double precision,
	"return_15m" double precision,
	"return_1h" double precision,
	"return_6h" double precision,
	"return_24h" double precision,
	"max_gain_1h" double precision,
	"max_gain_6h" double precision,
	"max_gain_24h" double precision,
	"max_drawdown_1h" double precision,
	"max_drawdown_24h" double precision,
	"calculated_at" timestamp with time zone NOT NULL,
	"coverage" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 4663 NOT NULL,
	"decimals" integer,
	"asset_type" text DEFAULT 'OTHER' NOT NULL,
	"deployer_address" text,
	"launch_platform" text,
	"created_at_chain" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dex_pair_address" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_verified_stock_token" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"runner_score" double precision,
	"smart_money_score" double precision,
	"momentum_score" double precision,
	"holder_score" double precision,
	"liquidity_score" double precision,
	"risk_penalty" double precision,
	"narrative_score" double precision,
	"final_score" double precision,
	"signal_type" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"token" text NOT NULL,
	"entry_transaction" text NOT NULL,
	"entry_price" double precision,
	"entry_market_cap" double precision,
	"amount" text NOT NULL,
	"total_cost" double precision,
	"opened_at" timestamp with time zone NOT NULL,
	"current_amount" text,
	"realized_pnl" double precision,
	"thesis" jsonb NOT NULL,
	"receipt_block" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"wallet" text,
	"follows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watchlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_a" text NOT NULL,
	"wallet_b" text NOT NULL,
	"relationship" text NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence" jsonb NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"period" text NOT NULL,
	"realized_pnl" double precision,
	"unrealized_pnl" double precision,
	"total_pnl" double precision,
	"win_rate" double precision,
	"trades" integer NOT NULL,
	"winning_trades" integer NOT NULL,
	"losing_trades" integer NOT NULL,
	"average_return" double precision,
	"median_return" double precision,
	"profit_factor" double precision,
	"max_drawdown" double precision,
	"average_hold_time" double precision,
	"median_hold_time" double precision,
	"average_entry_market_cap" double precision,
	"runner_hit_rate" double precision,
	"rug_rate" double precision,
	"early_entry_score" double precision,
	"consistency_score" double precision,
	"risk_score" double precision,
	"overall_score" double precision,
	"calculated_at" timestamp with time zone NOT NULL,
	"provenance" jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_token_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"token" text NOT NULL,
	"amount" text,
	"cost_basis" double precision,
	"realized_pnl" double precision,
	"unrealized_pnl" double precision,
	"first_buy" timestamp with time zone,
	"latest_buy" timestamp with time zone,
	"latest_sell" timestamp with time zone,
	"total_bought" double precision,
	"total_sold" double precision,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 4663 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"wallet_type" text DEFAULT 'unknown' NOT NULL,
	"public_label" text,
	"display_name" text,
	"x_handle" text,
	"kol_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "why_pumping_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"market_snapshot_timestamp" timestamp with time zone NOT NULL,
	"agent_version" text NOT NULL,
	"summary" text NOT NULL,
	"primary_catalyst" text NOT NULL,
	"catalysts" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"social_context" text NOT NULL,
	"smart_money_context" text NOT NULL,
	"risks" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"raw_agent_response" jsonb NOT NULL,
	"context" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD CONSTRAINT "signal_outcomes_signal_id_token_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."token_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_delivery_unique" ON "alert_deliveries" USING btree ("rule_id","event_key");--> statement-breakpoint
CREATE INDEX "alert_delivery_guest_idx" ON "alert_deliveries" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_rules_guest_idx" ON "alert_rules" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_blocks_hash_unique" ON "chain_blocks" USING btree ("chain_id","hash");--> statement-breakpoint
CREATE INDEX "chain_blocks_height_idx" ON "chain_blocks" USING btree ("chain_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_swaps_tx_log_unique" ON "chain_swaps" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_swaps_wallet_time" ON "chain_swaps" USING btree ("wallet_address","timestamp");--> statement-breakpoint
CREATE INDEX "chain_swaps_token_time" ON "chain_swaps" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE INDEX "chain_transfers_from_idx" ON "chain_transfers" USING btree ("from_address","timestamp");--> statement-breakpoint
CREATE INDEX "chain_transfers_to_idx" ON "chain_transfers" USING btree ("to_address","timestamp");--> statement-breakpoint
CREATE INDEX "liquidity_pools_token_idx" ON "liquidity_pools" USING btree ("token0","token1");--> statement-breakpoint
CREATE UNIQUE INDEX "market_observations_unique" ON "market_observations" USING btree ("token_address","timestamp","source");--> statement-breakpoint
CREATE INDEX "market_observations_token_time" ON "market_observations" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_chain_events_identity" ON "raw_chain_events" USING btree ("chain_id","block_hash","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "raw_chain_events_block_idx" ON "raw_chain_events" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "risk_assessments_token_time" ON "risk_assessments" USING btree ("token","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "token_profiles_chain_address" ON "token_profiles" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "token_signals_token_time" ON "token_signals" USING btree ("token","timestamp");--> statement-breakpoint
CREATE INDEX "token_signals_time_idx" ON "token_signals" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "user_positions_receipt_unique" ON "user_positions" USING btree ("wallet","token","entry_transaction");--> statement-breakpoint
CREATE INDEX "user_positions_wallet_idx" ON "user_positions" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "wallet_edges_a_idx" ON "wallet_edges" USING btree ("wallet_a");--> statement-breakpoint
CREATE INDEX "wallet_edges_b_idx" ON "wallet_edges" USING btree ("wallet_b");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_metrics_period_unique" ON "wallet_metrics" USING btree ("wallet_address","period");--> statement-breakpoint
CREATE INDEX "wallet_metrics_ranking_idx" ON "wallet_metrics" USING btree ("period","overall_score");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_token_positions_unique" ON "wallet_token_positions" USING btree ("wallet","token");--> statement-breakpoint
CREATE INDEX "why_pumping_token_time" ON "why_pumping_reports" USING btree ("token","generated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "chain_blocks_canonical_height" ON "chain_blocks" ("chain_id", "number") WHERE "canonical" = true;
--> statement-breakpoint
CREATE FUNCTION analyst_immutable_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Immutable history cannot be changed'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER raw_chain_events_immutable BEFORE UPDATE OR DELETE ON raw_chain_events FOR EACH ROW EXECUTE FUNCTION analyst_immutable_history();
--> statement-breakpoint
CREATE TRIGGER token_signals_immutable BEFORE UPDATE OR DELETE ON token_signals FOR EACH ROW EXECUTE FUNCTION analyst_immutable_history();
