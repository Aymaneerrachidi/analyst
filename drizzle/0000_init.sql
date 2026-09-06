CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"parent_id" text,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"ip_hash" text,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_source_syncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trades_upserted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"ip_hash" text,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_address" text NOT NULL,
	"window" text NOT NULL,
	"tracked_traders" integer DEFAULT 0 NOT NULL,
	"buyers" integer DEFAULT 0 NOT NULL,
	"sellers" integer DEFAULT 0 NOT NULL,
	"neutral" integer DEFAULT 0 NOT NULL,
	"buys" integer DEFAULT 0 NOT NULL,
	"sells" integer DEFAULT 0 NOT NULL,
	"buy_usd" double precision DEFAULT 0 NOT NULL,
	"sell_usd" double precision DEFAULT 0 NOT NULL,
	"net_flow_usd" double precision DEFAULT 0 NOT NULL,
	"top_buyer_id" text,
	"score" integer DEFAULT 0 NOT NULL,
	"score_quality" integer DEFAULT 0 NOT NULL,
	"score_accumulation" integer DEFAULT 0 NOT NULL,
	"score_breadth" integer DEFAULT 0 NOT NULL,
	"score_conviction" integer DEFAULT 0 NOT NULL,
	"score_momentum" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"address" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"price" double precision,
	"market_cap" double precision,
	"volume_24h" double precision,
	"price_change_24h" double precision,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"period" text NOT NULL,
	"pnl" double precision DEFAULT 0 NOT NULL,
	"roi" double precision,
	"trades" integer DEFAULT 0 NOT NULL,
	"buys" integer DEFAULT 0 NOT NULL,
	"sells" integer DEFAULT 0 NOT NULL,
	"volume_usd" double precision,
	"best_trade_usd" double precision,
	"win_rate" double precision,
	"rank" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_token_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"token_address" text NOT NULL,
	"first_buy_at" timestamp with time zone,
	"last_buy_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	"buys" integer DEFAULT 0 NOT NULL,
	"sells" integer DEFAULT 0 NOT NULL,
	"bought_usd" double precision DEFAULT 0 NOT NULL,
	"sold_usd" double precision DEFAULT 0 NOT NULL,
	"realized_pnl" double precision,
	"exposure_usd" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traders" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"avatar" text,
	"twitter_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"buys" integer DEFAULT 0 NOT NULL,
	"sells" integer DEFAULT 0 NOT NULL,
	"realized_pnl" double precision,
	"win_rate" double precision,
	"avg_trade_size" double precision,
	"volume_usd" double precision,
	"best_trade_usd" double precision,
	"native_balance" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"trader_id" text NOT NULL,
	"token_address" text NOT NULL,
	"side" text NOT NULL,
	"amount_usd" double precision,
	"token_amount" double precision,
	"price" double precision,
	"native_amount" double precision,
	"realized_pnl" double precision,
	"timestamp" timestamp with time zone NOT NULL,
	"tx_hash" text,
	"dex" text
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_snapshots" ADD CONSTRAINT "token_snapshots_token_address_tokens_address_fk" FOREIGN KEY ("token_address") REFERENCES "public"."tokens"("address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_snapshots" ADD CONSTRAINT "trader_snapshots_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_token_stats" ADD CONSTRAINT "trader_token_stats_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_token_stats" ADD CONSTRAINT "trader_token_stats_token_address_tokens_address_fk" FOREIGN KEY ("token_address") REFERENCES "public"."tokens"("address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_token_address_tokens_address_fk" FOREIGN KEY ("token_address") REFERENCES "public"."tokens"("address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_guest_idx" ON "comments" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_token_hash_unique" ON "guests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_guest_idx" ON "posts" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_unique" ON "ratings" USING btree ("guest_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "ratings_target_idx" ON "ratings" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ratings_guest_time_idx" ON "ratings" USING btree ("guest_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_unique" ON "reports" USING btree ("guest_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_snapshots_unique" ON "token_snapshots" USING btree ("token_address","window");--> statement-breakpoint
CREATE INDEX "token_snapshots_window_score" ON "token_snapshots" USING btree ("window","score");--> statement-breakpoint
CREATE INDEX "tokens_symbol_idx" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "tokens_last_activity_idx" ON "tokens" USING btree ("last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_snapshots_unique" ON "trader_snapshots" USING btree ("trader_id","period");--> statement-breakpoint
CREATE INDEX "trader_snapshots_period_rank" ON "trader_snapshots" USING btree ("period","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_token_stats_unique" ON "trader_token_stats" USING btree ("trader_id","token_address");--> statement-breakpoint
CREATE INDEX "trader_token_stats_token" ON "trader_token_stats" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "traders_handle_idx" ON "traders" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "traders_pnl_idx" ON "traders" USING btree ("realized_pnl");--> statement-breakpoint
CREATE INDEX "trades_timestamp_idx" ON "trades" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "trades_seq_idx" ON "trades" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "trades" USING btree ("trader_id","timestamp");--> statement-breakpoint
CREATE INDEX "trades_token_idx" ON "trades" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_unique" ON "votes" USING btree ("guest_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "votes_guest_time_idx" ON "votes" USING btree ("guest_id","updated_at");