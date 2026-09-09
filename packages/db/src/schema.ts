import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every timestamp in this schema is `timestamptz`. Dates are stored in UTC and
 * rendered in the operator's timezone; nothing here is a wall-clock date except
 * `channel_settings.daily_send_count_reset_on`, which tracks a provider quota
 * that resets on a calendar day.
 */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** A company is somewhere you might work; a client is somewhere that might hire you. */
export const organizationType = pgEnum("organization_type", [
  "company",
  "client",
]);

/** Why this person is in the book. A contact has exactly one — see ADR 0001. */
export const contactCategory = pgEnum("contact_category", ["freelance", "job"]);

/** Delivery channels. WhatsApp support is stubbed pending ticket 003. */
export const channel = pgEnum("channel", ["email", "whatsapp"]);

/**
 * Send lifecycle. `queued` -> `sending` -> `sent` | `failed`, or `canceled` if
 * the campaign was abandoned before the send left. `sending` is the worker's
 * claim marker: it exists so a crashed worker cannot double-send.
 */
export const sendStatus = pgEnum("send_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  "canceled",
]);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  website: text("website"),
  type: organizationType("type").notNull(),
  notes: text("notes"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: text("role"),
    notes: text("notes"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    category: contactCategory("category").notNull(),

    /**
     * Per-channel opt-in switches. Both default to false so a half-entered
     * contact is never reachable by accident; the operator turns a channel on
     * once the address or number is confirmed.
     */
    emailEnabled: boolean("email_enabled").notNull().default(false),
    whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),

    /**
     * WhatsApp consent record. The flag alone is not evidence, so the timestamp
     * and the free-text provenance ("replied to my DM on 4 Mar") are required
     * whenever the flag is set.
     */
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    whatsappOptInSource: text("whatsapp_opt_in_source"),

    /** Soft delete — see ADR 0002. Non-null means hidden from every contact list. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /**
     * One live contact per address per category. A person who is both a
     * freelance lead and a job contact is two rows, and this still stops the
     * same address being added to the same category twice.
     */
    uniqueIndex("contacts_email_category_unique")
      .on(t.email, t.category)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    index("contacts_organization_id_idx").on(t.organizationId),
    index("contacts_category_idx")
      .on(t.category)
      .where(sql`${t.deletedAt} is null`),

    check(
      "contacts_email_enabled_requires_address",
      sql`not ${t.emailEnabled} or ${t.email} is not null`,
    ),
    check(
      "contacts_whatsapp_enabled_requires_opt_in",
      sql`not ${t.whatsappEnabled} or (${t.phone} is not null and ${t.whatsappOptIn})`,
    ),
    check(
      "contacts_opt_in_requires_provenance",
      sql`not ${t.whatsappOptIn} or (${t.whatsappOptInAt} is not null and ${t.whatsappOptInSource} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** One flat namespace across both categories — `remote` means the same thing everywhere. */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("tags_name_unique").on(t.name)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.tagId] }),
    index("contact_tags_tag_id_idx").on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** A file living in Cloudinary. Rows here are pointers, never the bytes. */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudinaryPublicId: text("cloudinary_public_id").notNull(),
    url: text("url").notNull(),
    /** The name the file had on the operator's disk, used as the attachment name. */
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("documents_cloudinary_public_id_unique").on(
      t.cloudinaryPublicId,
    ),
    check("documents_size_bytes_positive", sql`${t.sizeBytes} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Email drafts
// ---------------------------------------------------------------------------

/**
 * A reusable template. `subject` and `body` may contain placeholders; the
 * resolved text lands on the send row, not here — see ADR 0003.
 */
export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  ...timestamps,
});

/** Documents attached by default when this draft is used. `position` fixes their order. */
export const emailDraftDocuments = pgTable(
  "email_draft_documents",
  {
    emailDraftId: uuid("email_draft_id")
      .notNull()
      .references(() => emailDrafts.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.emailDraftId, t.documentId] }),
    index("email_draft_documents_document_id_idx").on(t.documentId),
  ],
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/**
 * One batch of outreach. A campaign is a draft until `confirmedAt` is set; that
 * timestamp is the safety gate the worker checks before sending anything.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    channel: channel("channel").notNull(),
    emailDraftId: uuid("email_draft_id").references(() => emailDrafts.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("campaigns_confirmed_at_idx").on(t.confirmedAt),
    /** Email campaigns need a draft; WhatsApp campaigns must not carry one. */
    check(
      "campaigns_email_requires_draft",
      sql`(${t.channel} = 'email') = (${t.emailDraftId} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

/**
 * Both the outbound queue and the permanent audit log. A row is created
 * `queued` when a campaign is assembled and is never deleted afterwards, so
 * "have I already contacted this person?" is answerable forever.
 */
export const sends = pgTable(
  "sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    channel: channel("channel").notNull(),

    /**
     * The text actually sent, resolved at queue time. Deliberately a copy and
     * not a join to the draft: editing a draft must never rewrite history.
     */
    subject: text("subject"),
    body: text("body").notNull(),

    status: sendStatus("status").notNull().default("queued"),
    /** The provider's id for the message, used to reconcile bounces and replies. */
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    /** When the provider accepted the message, not when the row was queued. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /** Idempotency: a contact appears at most once in a campaign. */
    uniqueIndex("sends_campaign_id_contact_id_unique").on(
      t.campaignId,
      t.contactId,
    ),
    /** The worker's claim query: oldest queued row first. */
    index("sends_queue_idx").on(t.status, t.createdAt),
    index("sends_contact_id_idx").on(t.contactId),

    check(
      "sends_email_requires_subject",
      sql`(${t.channel} = 'email') = (${t.subject} is not null)`,
    ),
    check(
      "sends_sent_requires_receipt",
      sql`${t.status} <> 'sent' or (${t.providerMessageId} is not null and ${t.sentAt} is not null)`,
    ),
    check(
      "sends_failed_requires_error",
      sql`${t.status} <> 'failed' or ${t.error} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Channel settings
// ---------------------------------------------------------------------------

/**
 * Exactly one row per channel — `channel` is the primary key, so the type
 * system enforces the singleton. This is the only table holding secrets.
 */
export const channelSettings = pgTable(
  "channel_settings",
  {
    channel: channel("channel").primaryKey(),

    /** Gmail OAuth refresh token. Null until the operator connects the account. */
    gmailRefreshToken: text("gmail_refresh_token"),

    /**
     * Provider quota tracking. The counter is reset by the sender whenever
     * `dailySendCountResetOn` is older than today in the operator's timezone.
     */
    dailySendCount: integer("daily_send_count").notNull().default(0),
    dailySendCountResetOn: date("daily_send_count_reset_on", {
      mode: "string",
    })
      .notNull()
      .default(sql`current_date`),

    /** Shape deliberately unmodelled — pending ticket 003. */
    whatsappCredentials: jsonb("whatsapp_credentials").$type<
      Record<string, unknown>
    >(),
    ...timestamps,
  },
  (t) => [
    check(
      "channel_settings_daily_send_count_non_negative",
      sql`${t.dailySendCount} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const organizationsRelations = relations(organizations, ({ many }) => ({
  contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  contactTags: many(contactTags),
  sends: many(sends),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contactTags: many(contactTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactTags.contactId],
    references: [contacts.id],
  }),
  tag: one(tags, {
    fields: [contactTags.tagId],
    references: [tags.id],
  }),
}));

export const documentsRelations = relations(documents, ({ many }) => ({
  emailDraftDocuments: many(emailDraftDocuments),
}));

export const emailDraftsRelations = relations(emailDrafts, ({ many }) => ({
  emailDraftDocuments: many(emailDraftDocuments),
  campaigns: many(campaigns),
}));

export const emailDraftDocumentsRelations = relations(
  emailDraftDocuments,
  ({ one }) => ({
    emailDraft: one(emailDrafts, {
      fields: [emailDraftDocuments.emailDraftId],
      references: [emailDrafts.id],
    }),
    document: one(documents, {
      fields: [emailDraftDocuments.documentId],
      references: [documents.id],
    }),
  }),
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  emailDraft: one(emailDrafts, {
    fields: [campaigns.emailDraftId],
    references: [emailDrafts.id],
  }),
  sends: many(sends),
}));

export const sendsRelations = relations(sends, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [sends.campaignId],
    references: [campaigns.id],
  }),
  contact: one(contacts, {
    fields: [sends.contactId],
    references: [contacts.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type OrganizationType = (typeof organizationType.enumValues)[number];
export type ContactCategory = (typeof contactCategory.enumValues)[number];
export type Channel = (typeof channel.enumValues)[number];
export type SendStatus = (typeof sendStatus.enumValues)[number];

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export type ContactTag = typeof contactTags.$inferSelect;
export type NewContactTag = typeof contactTags.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type EmailDraft = typeof emailDrafts.$inferSelect;
export type NewEmailDraft = typeof emailDrafts.$inferInsert;

export type EmailDraftDocument = typeof emailDraftDocuments.$inferSelect;
export type NewEmailDraftDocument = typeof emailDraftDocuments.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Send = typeof sends.$inferSelect;
export type NewSend = typeof sends.$inferInsert;

export type ChannelSettings = typeof channelSettings.$inferSelect;
export type NewChannelSettings = typeof channelSettings.$inferInsert;
