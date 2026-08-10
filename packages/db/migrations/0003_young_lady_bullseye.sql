CREATE TABLE "recurring_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant" text NOT NULL,
	"merchant_key" text NOT NULL,
	"amount" numeric NOT NULL,
	"frequency" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_series_merchant_key" ON "recurring_series" USING btree ("merchant_key");