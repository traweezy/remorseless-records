### local setup

Video instructions: https://youtu.be/PPxenu7IjGM

- `cd backend`
- `pnpm install`
- Rename `.env.template` -> `.env`
- To connect to your online database from your local machine, copy the `DATABASE_URL` value auto-generated on Railway and add it to your `.env` file.
  - If connecting to a new database, for example a local one, run `pnpm ib` to seed the database.
- `pnpm dev`

### requirements

- **postgres database** (Automatic setup when using the Railway template)
- **redis** (Automatic setup when using the Railway template) - fallback to simulated redis.
- **MinIO storage** (Automatic setup when using the Railway template) - fallback to local storage.
- **Meilisearch** (Automatic setup when using the Railway template)

### tax lookup cache (optional)

The tax rate lookup module uses an in-memory cache and can also use Redis when
`REDIS_URL` is set. Configure the TTL via:

- `TAX_RATE_LOOKUP_CACHE_TTL_MS` (default: `300000`)

### anonymous cart retention

The daily `remove-expired-anonymous-carts` job uses Medusa's Locking Module and
soft-deletes only incomplete carts that have no customer or email association.
It is disabled by default so each deployed environment must opt in explicitly.
When `REDIS_URL` is configured, Medusa uses its Redis locking provider so the
job remains single-run across backend replicas; local environments without
Redis retain Medusa's in-memory fallback.

- `ANONYMOUS_CART_RETENTION_ENABLED` (default: `false`)
- `ANONYMOUS_CART_RETENTION_DAYS` (default/minimum: `37`)
- `ANONYMOUS_CART_RETENTION_MAX_DELETIONS` (default: `1000`, maximum: `10000`)

The 37-day minimum preserves the storefront's 30-day inactivity window plus a
seven-day cleanup grace period. Successful cart mutations refresh the browser
cookie; merely viewing a cart does not.

### commands

`cd backend/`
`pnpm ib` will initialize the backend by running migrations and seed the database with required system data.
`pnpm dev` will start the backend (and admin dashboard frontend on `localhost:9000/app`) in development mode.
`pnpm build && pnpm start` will compile the project and run from compiled source. This can be useful for reproducing issues on your cloud instance.
