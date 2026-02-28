#!/usr/bin/env node
/**
 * Rebuilds profiles.json index from all individual profile.json files.
 * Run from repo root: node scripts/rebuild-index.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PROFILES_DIR = join(ROOT, 'profiles')
const INDEX_PATH = join(ROOT, 'profiles.json')

const entries = []
const dirs = readdirSync(PROFILES_DIR).filter(d =>
  statSync(join(PROFILES_DIR, d)).isDirectory()
)

for (const dir of dirs) {
  const profilePath = join(PROFILES_DIR, dir, 'profile.json')
  try {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'))
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
  } catch (err) {
    console.error(`Skipping ${dir}: ${err.message}`)
  }
}

entries.sort((a, b) => a.title.localeCompare(b.title))

const catalog = {
  version: 1,
  generated_at: new Date().toISOString(),
  total: entries.length,
  profiles: entries,
}

writeFileSync(INDEX_PATH, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Rebuilt profiles.json with ${entries.length} entries`)
