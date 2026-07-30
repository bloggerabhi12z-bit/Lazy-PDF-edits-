CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operations_user_created_idx" ON "operations" ("user_id","created_at");