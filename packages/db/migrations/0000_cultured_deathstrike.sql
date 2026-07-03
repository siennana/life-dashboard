CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"start_ts" timestamp with time zone NOT NULL,
	"end_ts" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text,
	"date" date NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"cursor" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_id" ON "events" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_source_name_date" ON "metrics" USING btree ("source","name","date");