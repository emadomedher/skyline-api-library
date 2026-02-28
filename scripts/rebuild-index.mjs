#!/usr/bin/env node
/**
 * Rebuilds profiles.json and profiles-slim.json from all individual profile.json files.
 *
 * profiles.json      — full index for the website library page (browsing, display)
 * profiles-slim.json — stripped index for skyline-mcp (adding APIs, no subtitle/logo/tags)
 *
 * Run from repo root: node scripts/rebuild-index.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PROFILES_DIR = join(ROOT, 'profiles')
const INDEX_PATH = join(ROOT, 'profiles.json')
const SLIM_PATH = join(ROOT, 'profiles-slim.json')

const entries = []
const slimEntries = []
const dirs = readdirSync(PROFILES_DIR).filter(d =>
  statSync(join(PROFILES_DIR, d)).isDirectory()
)

for (const dir of dirs) {
  const profilePath = join(PROFILES_DIR, dir, 'profile.json')
  try {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'))

    // Full entry for website
    entries.push({
      id: profile.id,
      title: profile.title,
      subtitle: profile.subtitle,
      logo: profile.logo || '',
      tags: profile.tags,
      category: profile.category,
      authType: profile.authType,
      selfHostable: profile.selfHostable || false,
      website: profile.website || '',
      profilePath: `profiles/${profile.id}/profile.json`,
    })

    // Slim entry for skyline-mcp — only what's needed to browse + add an API
    // Short keys: t=title, d=description(subtitle), c=category, at=authType,
    //             su=specUrl, st=specType, bu=baseUrl, w=website
    const slim = {
      id: profile.id,
      t: profile.title,
      c: profile.category,
      at: profile.authType,
    }
    if (profile.subtitle) slim.d = profile.subtitle.slice(0, 80)
    if (profile.specUrl) slim.su = profile.specUrl
    if (profile.specType && profile.specType !== 'auto-detect') slim.st = profile.specType
    if (profile.baseUrl) slim.bu = profile.baseUrl
    if (profile.website) slim.w = profile.website
    slimEntries.push(slim)
  } catch (err) {
    console.error(`Skipping ${dir}: ${err.message}`)
  }
}

entries.sort((a, b) => a.title.localeCompare(b.title))
slimEntries.sort((a, b) => a.t.localeCompare(b.t))

const now = new Date().toISOString()

// Full index
const catalog = {
  version: 1,
  generated_at: now,
  total: entries.length,
  profiles: entries,
}
writeFileSync(INDEX_PATH, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Rebuilt profiles.json with ${entries.length} entries`)

// Slim index (compact JSON, no pretty-print to minimize size)
const slim = {
  v: 1,
  total: slimEntries.length,
  profiles: slimEntries,
}
writeFileSync(SLIM_PATH, JSON.stringify(slim) + '\n')
const slimSize = (Buffer.byteLength(JSON.stringify(slim)) / 1024).toFixed(0)
console.log(`Rebuilt profiles-slim.json with ${slimEntries.length} entries (${slimSize} KB)`)
