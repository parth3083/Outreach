CREATE TYPE "public"."channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."contact_category" AS ENUM('freelance', 'job');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('company', 'client');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" "channel" NOT NULL,
	"email_draft_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_email_requires_draft" CHECK (("campaigns"."channel" = 'email') = ("campaigns"."email_draft_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "channel_settings" (
	"channel" "channel" PRIMARY KEY NOT NULL,
	"gmail_refresh_token" text,
	"daily_send_count" integer DEFAULT 0 NOT NULL,
	"daily_send_count_reset_on" date DEFAULT current_date NOT NULL,
	"whatsapp_credentials" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_settings_daily_send_count_non_negative" CHECK ("channel_settings"."daily_send_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"notes" text,
	"organization_id" uuid,
	"category" "contact_category" NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT false NOT NULL,
	"whatsapp_opt_in_at" timestamp with time zone,
	"whatsapp_opt_in_source" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_enabled_requires_address" CHECK (not "contacts"."email_enabled" or "contacts"."email" is not null),
	CONSTRAINT "contacts_whatsapp_enabled_requires_opt_in" CHECK (not "contacts"."whatsapp_enabled" or ("contacts"."phone" is not null and "contacts"."whatsapp_opt_in")),
	CONSTRAINT "contacts_opt_in_requires_provenance" CHECK (not "contacts"."whatsapp_opt_in" or ("contacts"."whatsapp_opt_in_at" is not null and "contacts"."whatsapp_opt_in_source" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_size_bytes_positive" CHECK ("documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "email_draft_documents" (
	"email_draft_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_draft_documents_email_draft_id_document_id_pk" PRIMARY KEY("email_draft_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"type" "organization_type" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "send_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sends_email_requires_subject" CHECK (("sends"."channel" = 'email') = ("sends"."subject" is not null)),
	CONSTRAINT "sends_sent_requires_receipt" CHECK ("sends"."status" <> 'sent' or ("sends"."provider_message_id" is not null and "sends"."sent_at" is not null)),
	CONSTRAINT "sends_failed_requires_error" CHECK ("sends"."status" <> 'failed' or "sends"."error" is not null)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_draft_id_email_drafts_id_fk" FOREIGN KEY ("email_draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_draft_documents" ADD CONSTRAINT "email_draft_documents_email_draft_id_email_drafts_id_fk" FOREIGN KEY ("email_draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_draft_documents" ADD CONSTRAINT "email_draft_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_confirmed_at_idx" ON "campaigns" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "contact_tags_tag_id_idx" ON "contact_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_category_unique" ON "contacts" USING btree ("email","category") WHERE "contacts"."email" is not null and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_organization_id_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_category_idx" ON "contacts" USING btree ("category") WHERE "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_cloudinary_public_id_unique" ON "documents" USING btree ("cloudinary_public_id");--> statement-breakpoint
CREATE INDEX "email_draft_documents_document_id_idx" ON "email_draft_documents" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_campaign_id_contact_id_unique" ON "sends" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "sends_queue_idx" ON "sends" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sends_contact_id_idx" ON "sends" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unique" ON "tags" USING btree ("name");