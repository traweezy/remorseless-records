#!/usr/bin/env node

/**
 * Custom backend bootstrapper that extends the default Medusa launch utils so
 * we can be more patient with Meilisearch readiness during deploys. Railway
 * occasionally routes requests to Meilisearch before the service is warmed up,
 * which made the stock init script give up after a handful of 404 responses.
 *
 * We retry with exponential backoff, treat common transient status codes as
 * recoverable, and gracefully fall back to the master key so the container
 * can finish booting even if Meilisearch is briefly unavailable.
 */

const { appendToEnvFile } = require('medusajs-launch-utils/src/utils')
const {
  prepareEnvironment: defaultPrepareEnvironment,
  seedOnce,
  reportDeploy,
} = require('medusajs-launch-utils/src/initializeBackend')
const { execSync } = require('child_process')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RETRYABLE_STATUS_CODES = new Set([404, 408, 425, 429, 500, 502, 503, 504])

const parseIntegerEnv = (name, fallback) => {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const fetchAdminKeyWithPatience = async (host, masterKey) => {
  const attempts = parseIntegerEnv('MEILISEARCH_KEY_FETCH_ATTEMPTS', 12)
  const initialDelayMs = parseIntegerEnv('MEILISEARCH_KEY_FETCH_DELAY_MS', 3000)
  const maxDelayMs = parseIntegerEnv('MEILISEARCH_KEY_FETCH_MAX_DELAY_MS', 15000)

  const url = new URL('/keys', host).toString()

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptLabel = `[meilisearch][admin-key][attempt ${attempt}/${attempts}]`
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${masterKey}`,
        },
      })

      if (!response.ok) {
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          console.warn(
            `${attemptLabel} Meilisearch not ready (status ${response.status}). Retrying shortly.`,
          )
        } else {
          console.error(
            `${attemptLabel} Received non-retryable response (status ${response.status}).`,
          )
          return null
        }
      } else {
        const body = await response.json()
        const adminKeyEntry = Array.isArray(body?.results)
          ? body.results.find(
              (entry) =>
                entry &&
                Array.isArray(entry.actions) &&
                entry.actions.includes('*') &&
                typeof entry.key === 'string' &&
                entry.key.length > 0,
            )
          : null

        if (!adminKeyEntry?.key) {
          console.error(`${attemptLabel} No admin key present in Meilisearch response.`)
          return null
        }

        console.log(`${attemptLabel} Retrieved Meilisearch admin key.`)
        return adminKeyEntry.key
      }
    } catch (error) {
      console.warn(`${attemptLabel} Network error fetching Meilisearch key: ${error.message}`)
    }

    const exponentialDelay = Math.min(
      initialDelayMs * 2 ** (attempt - 1),
      maxDelayMs,
    )
    await sleep(exponentialDelay)
  }

  console.error('[meilisearch][admin-key] Exhausted retry budget without success.')
  return null
}

const ensureMeilisearchAdminKey = async () => {
  if (process.env.MEILISEARCH_ADMIN_KEY) {
    return
  }

  const host = process.env.MEILISEARCH_HOST
  const masterKey = process.env.MEILISEARCH_MASTER_KEY

  if (!host || !masterKey) {
    console.warn('[meilisearch][admin-key] Host or master key missing; skipping fetch.')
    return
  }

  const adminKey = await fetchAdminKeyWithPatience(host, masterKey)

  if (adminKey) {
    process.env.MEILISEARCH_ADMIN_KEY = adminKey
    await appendToEnvFile('MEILISEARCH_ADMIN_KEY', adminKey)
    console.log('[meilisearch][admin-key] Persisted admin key to environment.')
    return
  }

  console.warn(
    '[meilisearch][admin-key] Falling back to MEILISEARCH_MASTER_KEY for this process run.',
  )
  process.env.MEILISEARCH_ADMIN_KEY = masterKey
}

const initialize = async () => {
  try {
    await ensureMeilisearchAdminKey()
    await defaultPrepareEnvironment()
    await seedOnce()
    await reportDeploy()

    try {
      console.log('[search][prepare] Running Meilisearch sync/reindex...')
      execSync('pnpm run search:prepare', {
        stdio: 'inherit',
        env: {
          ...process.env,
          FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
        },
      })
      console.log('[search][prepare] Completed successfully.')
    } catch (searchError) {
      console.warn(
        '[search][prepare] Failed to sync/rebuild Meilisearch index. The service will continue to boot. Error:',
        searchError?.message ?? searchError
      )
    }

    console.log('Backend initialized successfully')
  } catch (error) {
    console.error('Error initializing backend:', error)
    process.exit(1)
  }
}

initialize()
