CREATE TABLE "event_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_id" integer NOT NULL,
	"event_external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_tags_tag_event" ON "event_tags" USING btree ("tag_id","event_external_id");