#!/usr/bin/env node
/**
 * Generates profiles-slim.json from profiles.json.
 * Run from repo root: node scripts/generate-slim.mjs
 *
 * Input:  profiles.json             — full index maintained by hand / scraper
 *         profiles/{id}/profile.json — individual profiles (may contain setup fields)
 * Output: profiles-slim.json        — compact index for skyline-mcp library loading
 *
 * Short keys: id, t=title, d=description, c=category, at=authType,
 *             su=specUrl, st=specType, bu=baseUrl, w=website, s=setup
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INPUT = join(ROOT, 'profiles.json')
const OUTPUT = join(ROOT, 'profiles-slim.json')

const catalog = JSON.parse(readFileSync(INPUT, 'utf-8'))
const profiles = catalog.profiles || []

const slimEntries = profiles.map(p => {
  const slim = {
    id: p.id,
    t: p.title,
    c: p.category,
    at: p.authType,
  }
  if (p.subtitle) slim.d = p.subtitle.slice(0, 80)

  // These fields live in the individual profile.json files but not in the
  // current profiles.json index. When they are present, include them.
  if (p.specUrl) slim.su = p.specUrl
  if (p.specType && p.specType !== 'auto-detect') slim.st = p.specType
  if (p.baseUrl) slim.bu = p.baseUrl
  if (p.website) slim.w = p.website

  // Check for setup data in the individual profile.json
  // (guided setup fields for auth, verification, tutorials)
  if (p.setup) {
    slim.s = p.setup
  } else {
    const profilePath = join(ROOT, 'profiles', p.id, 'profile.json')
    if (existsSync(profilePath)) {
      try {
        const individual = JSON.parse(readFileSync(profilePath, 'utf-8'))
        if (individual.setup) slim.s = individual.setup
      } catch { /* ignore parse errors */ }
    }
  }

  return slim
})

slimEntries.sort((a, b) => a.t.localeCompare(b.t))

const slim = {
  v: 1,
  total: slimEntries.length,
  profiles: slimEntries,
}

writeFileSync(OUTPUT, JSON.stringify(slim) + '\n')
const sizeKB = (Buffer.byteLength(JSON.stringify(slim)) / 1024).toFixed(0)
console.log(`Generated profiles-slim.json — ${slimEntries.length} entries (${sizeKB} KB)`)
const withSetup = slimEntries.filter(e => e.s).length
if (withSetup) console.log(`  ${withSetup} profiles have guided setup fields`)
