#!/usr/bin/env node
/**
 * Generates the secrets a self-hosted Supabase stack needs:
 *
 *   JWT_SECRET          random 40-char secret shared by GoTrue/PostgREST/Storage
 *   ANON_KEY            JWT signed with that secret, role = anon
 *   SERVICE_ROLE_KEY    JWT signed with that secret, role = service_role
 *   POSTGRES_PASSWORD   random database password
 *   DASHBOARD_PASSWORD  random Studio password
 *   CRON_SECRET         bearer token guarding /api/cron/*
 *
 * Usage:
 *   node scripts/generate-supabase-keys.mjs            # print to stdout
 *   node scripts/generate-supabase-keys.mjs >> .env    # append to your env file
 *
 * Pass an existing secret to keep it: JWT_SECRET=... node scripts/generate-supabase-keys.mjs
 */
import crypto from 'node:crypto'

const YEARS = 10
const b64url = buf => Buffer.from(buf).toString('base64url')
const randomSecret = (bytes = 30) => crypto.randomBytes(bytes).toString('base64url')

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

const jwtSecret = process.env.JWT_SECRET || randomSecret(30)
const iat = Math.floor(Date.now() / 1000)
const exp = iat + YEARS * 365 * 24 * 60 * 60

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret)
const serviceKey = signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret)

process.stdout.write(`# Generated ${new Date().toISOString()} — keep these out of git
JWT_SECRET=${jwtSecret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceKey}
POSTGRES_PASSWORD=${randomSecret(24)}
DASHBOARD_PASSWORD=${randomSecret(18)}
CRON_SECRET=${randomSecret(24)}
`)
