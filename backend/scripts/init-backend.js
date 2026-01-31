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

require('dotenv').config()

const fs = require('fs')
const fsPromises = require('fs/promises')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const { Client } = require('pg')

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

const getEnvPaths = () => {
  const currentDir = process.cwd()
  const isBuiltEnv = currentDir.includes('.medusa/server')

  if (isBuiltEnv) {
    return [path.resolve(currentDir, '.env')]
  }

  return [
    path.resolve(currentDir, '.env'),
    path.resolve(currentDir, '.medusa/server/.env'),
  ]
}

const appendToEnvFile = async (key, value) => {
  const envPaths = getEnvPaths()

  for (const envPath of envPaths) {
    try {
      let envContent = ''
      await fsPromises.mkdir(path.dirname(envPath), { recursive: true })

      try {
        envContent = await fsPromises.readFile(envPath, 'utf-8')
      } catch (error) {
        if (error.code === 'ENOENT') {
          await fsPromises.writeFile(envPath, '', 'utf-8')
          console.log(`Created new .env file at ${envPath}`)
        } else {
          throw error
        }
      }

      const keyRegex = new RegExp(`^${key}=.*$`, 'm')
      if (keyRegex.test(envContent)) {
        const updatedContent = envContent.replace(keyRegex, `${key}=${value}`)
        await fsPromises.writeFile(envPath, updatedContent, 'utf-8')
      } else {
        const newLine = envContent.length > 0 && !envContent.endsWith('\n') ? '\n' : ''
        await fsPromises.appendFile(envPath, `${newLine}${key}=${value}\n`)
      }

      console.log(`Successfully updated ${key} in ${envPath}`)
    } catch (error) {
      console.error(`Failed to update .env file at ${envPath}:`, error)
    }
  }
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

const resolveMedusaCliPath = () => {
  const serverCli = path.resolve(
    process.cwd(),
    '.medusa/server/node_modules/@medusajs/cli/cli.js',
  )
  const localCli = path.resolve(
    process.cwd(),
    'node_modules/@medusajs/cli/cli.js',
  )

  if (fs.existsSync(serverCli)) {
    return serverCli
  }
  if (fs.existsSync(localCli)) {
    return localCli
  }

  throw new Error('Medusa CLI not found. Ensure dependencies are installed.')
}

const runMedusaCommand = (args) => {
  const cliPath = resolveMedusaCliPath()
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
    },
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Medusa CLI exited with status ${result.status}`)
  }
}

const checkIfSeeded = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  })

  try {
    await client.connect()
    await client.query('SELECT 1 FROM "user" LIMIT 1;')
    return true
  } catch (error) {
    if (error.message?.includes('relation "user" does not exist')) {
      return false
    }
    console.error('Unexpected error checking if database is seeded:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

const seedDatabase = async () => {
  try {
    console.log('Running migrations...')
    runMedusaCommand(['db:migrate'])

    console.log('Running link sync...')
    runMedusaCommand(['db:sync-links'])

    console.log('Running seed script...')
    execSync('pnpm run seed', {
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
      },
    })

    const adminEmail = process.env.MEDUSA_ADMIN_EMAIL
    const adminPassword = process.env.MEDUSA_ADMIN_PASSWORD
    if (adminEmail && adminPassword) {
      console.log('Creating admin user...')
      runMedusaCommand(['user', '-e', adminEmail, '-p', adminPassword])
    }

    console.log('Database seeded and admin user created successfully.')
  } catch (error) {
    console.error('Failed to seed database or create admin user:', error)
    process.exit(1)
  }
}

const seedOnce = async () => {
  if (process.env.MEDUSA_WORKER_MODE === 'worker') {
    console.log('Running in worker mode, skipping database seeding.')
    return
  }

  const isSeeded = await checkIfSeeded()
  if (!isSeeded) {
    console.log('Database is not seeded. Seeding now...')
    await seedDatabase()
  } else {
    console.log('Database is already seeded. Skipping seeding.')
  }
}

const reportDeploy = async () => {
  const url = process.env.TEMPLATE_REPORTER_URL
  if (!url) {
    return
  }

  const payload = {
    projectId: process.env.RAILWAY_PROJECT_ID,
    templateId: 'medusa-2.0',
    publicUrl: process.env.PUBLIC_URL,
    storefrontPublishUrl: process.env.STOREFRONT_PUBLISH_URL,
  }

  try {
    await fetch(`${url}/api/projectDeployed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    console.error(`An error occurred: ${error.message}`)
  }
}

const initialize = async () => {
  try {
    await ensureMeilisearchAdminKey()
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
