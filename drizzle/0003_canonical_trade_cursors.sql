ALTER TABLE "chain_swaps" ADD COLUMN "seq" bigint DEFAULT nextval('trades_seq_seq') NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_swaps_seq_unique" ON "chain_swaps" USING btree ("seq");