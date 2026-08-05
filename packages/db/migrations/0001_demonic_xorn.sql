CREATE TABLE "calendar_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_days_date" ON "calendar_days" USING btree ("date");