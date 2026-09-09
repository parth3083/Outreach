# `@repo/db`

Postgres schema and client for the outreach platform, using Drizzle ORM.
The domain vocabulary these tables encode lives in [`CONTEXT.md`](../../CONTEXT.md);
the decisions behind the shape are in [`docs/adr/`](../../docs/adr/).

## Setup

```sh
cp packages/db/.env.example packages/db/.env   # then fill in DATABASE_URL
bun run --filter @repo/db db:migrate
```

## Scripts

| Script        | What it does                                                 |
| ------------- | ------------------------------------------------------------ |
| `db:generate` | Diff `src/schema.ts` against `drizzle/` and emit a migration |
| `db:migrate`  | Apply pending migrations                                     |
| `db:push`     | Shove the schema straight at the database — local only       |
| `db:studio`   | Open Drizzle Studio                                          |

Migrations in `drizzle/` are committed. Generate one whenever `src/schema.ts`
changes; don't hand-edit a migration that has already been applied anywhere.

## Usage

```ts
import { db, contacts, type Contact } from "@repo/db";
import { and, isNull, eq } from "drizzle-orm";

// Soft delete means every contact query filters deletedAt — see ADR 0002.
const leads = await db
  .select()
  .from(contacts)
  .where(and(isNull(contacts.deletedAt), eq(contacts.category, "freelance")));
```

Import from `@repo/db/schema` instead when you only want tables and types;
that entry point has no `DATABASE_URL` requirement, so it is safe to pull into
tooling and tests.

## Where the invariants live

The schema pushes rules into the database rather than trusting callers, because
this package is written against by background workers as well as the app:

- A channel cannot be enabled without the address it needs, and WhatsApp cannot
  be enabled without a timestamped, sourced opt-in.
- An email campaign must have a draft; a WhatsApp campaign must not.
- A send marked `sent` must carry a provider message id and a sent timestamp;
  one marked `failed` must carry an error.
- A contact appears at most once per campaign, so a retried queue run cannot
  double-send.
- Contacts with send history cannot be hard-deleted.

Adding a code path that needs one of these relaxed is a schema change and
probably an ADR, not a workaround.
