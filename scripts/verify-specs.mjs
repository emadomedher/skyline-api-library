#!/usr/bin/env node
/**
 * Verify API spec URLs are reachable and parseable.
 *
 * Usage:
 *   node scripts/verify-specs.mjs                  # test all untested profiles with specUrl
 *   node scripts/verify-specs.mjs --ids=slack,github  # test specific profiles
 *   node scripts/verify-specs.mjs --retest          # retest everything (including already tested)
 *   node scripts/verify-specs.mjs --dry-run         # show what would be tested, don't fetch
 *
 * Outputs:
 *   - Updates profiles/{id}/profile.json with compatibility, tested, testedAt
 *   - Writes compatibility-results.json with full results summary
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PROFILES_DIR = join(ROOT, 'profiles')
const OVERRIDES_FILE = join(ROOT, 'compatibility-overrides.json')
const RESULTS_FILE = join(ROOT, 'compatibility-results.json')

// Parse CLI args
const args = process.argv.slice(2)
const retest = args.includes('--retest')
const dryRun = args.includes('--dry-run')
const idsArg = args.find(a => a.startsWith('--ids='))
const requestedIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(s => s.trim()).filter(Boolean) : null
const concurrency = parseInt((args.find(a => a.startsWith('--concurrency=')) || '').replace('--concurrency=', '') || '5')
const timeout = parseInt((args.find(a => a.startsWith('--timeout=')) || '').replace('--timeout=', '') || '30000')

// Load manual overrides
let overrides = {}
if (existsSync(OVERRIDES_FILE)) {
  overrides = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf-8')).overrides || {}
}

// Load existing results
let existingResults = {}
if (existsSync(RESULTS_FILE)) {
  existingResults = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')).results || {}
}

// Collect profiles to test
function collectProfiles() {
  const dirs = readdirSync(PROFILES_DIR).filter(d =>
    statSync(join(PROFILES_DIR, d)).isDirectory()
  )

  const candidates = []
  for (const id of dirs) {
    const profilePath = join(PROFILES_DIR, id, 'profile.json')
    if (!existsSync(profilePath)) continue

    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'))

    // If specific IDs requested, filter to those
    if (requestedIds && !requestedIds.includes(id)) continue

    // Skip profiles without specUrl (nothing to test)
    if (!profile.specUrl) continue

    // Skip manual overrides (already settled by humans)
    if (overrides[id] && !requestedIds) continue

    // Skip already tested unless --retest
    if (!retest && profile.tested && !requestedIds) continue

    candidates.push({ id, profile, profilePath })
  }

  return candidates
}

// Detect spec format from parsed content
function detectSpecFormat(content, contentType) {
  if (typeof content !== 'object' || content === null) return null

  // OpenAPI 3.x
  if (content.openapi && typeof content.openapi === 'string' && content.openapi.startsWith('3')) {
    const pathCount = content.paths ? Object.keys(content.paths).length : 0
    return { format: 'openapi', version: content.openapi, title: content.info?.title, pathCount }
  }

  // Swagger 2.x
  if (content.swagger && typeof content.swagger === 'string' && content.swagger.startsWith('2')) {
    const pathCount = content.paths ? Object.keys(content.paths).length : 0
    return { format: 'swagger2', version: content.swagger, title: content.info?.title, pathCount }
  }

  // Google Discovery
  if (content.kind === 'discovery#restDescription' || content.discoveryVersion) {
    const methodCount = countGoogleMethods(content)
    return { format: 'google-discovery', version: content.discoveryVersion || 'v1', title: content.title, pathCount: methodCount }
  }

  // AsyncAPI
  if (content.asyncapi) {
    const channelCount = content.channels ? Object.keys(content.channels).length : 0
    return { format: 'asyncapi', version: content.asyncapi, title: content.info?.title, pathCount: channelCount }
  }

  // OpenRPC
  if (content.openrpc) {
    const methodCount = content.methods ? content.methods.length : 0
    return { format: 'openrpc', version: content.openrpc, title: content.info?.title, pathCount: methodCount }
  }

  return null
}

function countGoogleMethods(doc) {
  let count = 0
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return
    if (obj.methods) count += Object.keys(obj.methods).length
    if (obj.resources) {
      for (const r of Object.values(obj.resources)) walk(r)
    }
  }
  walk(doc)
  return count
}

// Load js-yaml once
let yamlModule = null
async function getYaml() {
  if (yamlModule) return yamlModule
  try {
    yamlModule = (await import('js-yaml')).default
  } catch { yamlModule = null }
  return yamlModule
}

// Parse content as JSON or YAML
async function parseContent(text, contentType, url) {
  // Try JSON first
  try {
    return JSON.parse(text)
  } catch {}

  // Try YAML for anything that isn't valid JSON
  // Triggers on: .yaml/.yml URLs, yaml content-type, YAML markers, or as fallback
  const yaml = await getYaml()
  if (yaml) {
    try {
      const result = yaml.load(text)
      if (result && typeof result === 'object') return result
    } catch { /* not valid YAML either */ }
  }

  return null
}

// Fetch and verify a single spec URL
async function verifySpec(id, specUrl, specType) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(specUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, application/yaml, text/yaml, */*',
        'User-Agent': 'skyline-api-library/1.0 spec-verifier',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)

    if (!res.ok) {
      return {
        id,
        compatibility: 'broken',
        tested: true,
        error: `HTTP ${res.status} ${res.statusText}`,
        statusCode: res.status,
      }
    }

    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()

    if (!text || text.length < 10) {
      return {
        id,
        compatibility: 'broken',
        tested: true,
        error: 'Empty or too-small response',
        responseSize: text.length,
      }
    }

    const parsed = await parseContent(text, contentType, specUrl)
    if (!parsed) {
      return {
        id,
        compatibility: 'broken',
        tested: true,
        error: 'Could not parse response as JSON or YAML',
        responseSize: text.length,
        contentType,
      }
    }

    const detected = detectSpecFormat(parsed, contentType)
    if (!detected) {
      return {
        id,
        compatibility: 'broken',
        tested: true,
        error: 'Parsed but not a recognized API spec format',
        responseSize: text.length,
        contentType,
      }
    }

    return {
      id,
      compatibility: 'working',
      tested: true,
      format: detected.format,
      version: detected.version,
      title: detected.title,
      pathCount: detected.pathCount,
      responseSize: text.length,
    }
  } catch (err) {
    clearTimeout(timer)
    const msg = err.name === 'AbortError'
      ? `Timeout after ${timeout}ms`
      : err.message
    return {
      id,
      compatibility: 'broken',
      tested: true,
      error: msg,
    }
  }
}

// Run verification in batches
async function runBatch(candidates, batchSize) {
  const results = []
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(c => verifySpec(c.id, c.profile.specUrl, c.profile.specType))
    )
    results.push(...batchResults)

    // Progress
    const done = Math.min(i + batchSize, candidates.length)
    process.stdout.write(`\r  Verified ${done}/${candidates.length}`)
  }
  if (candidates.length > 0) process.stdout.write('\n')
  return results
}

// Main
async function main() {
  console.log('Skyline API Library — Spec Verification')
  console.log('=======================================\n')

  const candidates = collectProfiles()
  console.log(`Profiles with specUrl: ${candidates.length} to verify`)
  console.log(`Manual overrides: ${Object.keys(overrides).length} (skipped)`)
  if (retest) console.log('Mode: --retest (re-verifying all)')
  if (requestedIds) console.log(`Filtering to: ${requestedIds.join(', ')}`)
  console.log()

  if (dryRun) {
    console.log('Dry run — would test:')
    candidates.forEach(c => console.log(`  ${c.id} -> ${c.profile.specUrl}`))
    process.exit(0)
  }

  if (candidates.length === 0) {
    console.log('Nothing to verify.')
    process.exit(0)
  }

  // Install js-yaml if not present (for YAML specs)
  try {
    await import('js-yaml')
  } catch {
    console.log('Installing js-yaml for YAML parsing...')
    const { execSync } = await import('child_process')
    execSync('npm install --no-save js-yaml', { cwd: ROOT, stdio: 'pipe' })
  }

  console.log(`Verifying specs (concurrency=${concurrency}, timeout=${timeout}ms)...\n`)
  const results = await runBatch(candidates, concurrency)

  // Tally
  const working = results.filter(r => r.compatibility === 'working')
  const broken = results.filter(r => r.compatibility === 'broken')

  console.log(`\nResults: ${working.length} working, ${broken.length} broken\n`)

  if (working.length > 0) {
    console.log('Working:')
    working.forEach(r => console.log(`  ✓ ${r.id} — ${r.format} ${r.version} (${r.pathCount} paths)`))
  }

  if (broken.length > 0) {
    console.log('\nBroken:')
    broken.forEach(r => console.log(`  ✗ ${r.id} — ${r.error}`))
  }

  // Update individual profile.json files
  const now = new Date().toISOString()
  for (const result of results) {
    const c = candidates.find(c => c.id === result.id)
    if (!c) continue

    c.profile.compatibility = result.compatibility
    c.profile.tested = true
    c.profile.testedAt = now

    writeFileSync(c.profilePath, JSON.stringify(c.profile, null, 2) + '\n')
  }

  // Also apply manual overrides to their profile.json files
  for (const [id, override] of Object.entries(overrides)) {
    const profilePath = join(PROFILES_DIR, id, 'profile.json')
    if (!existsSync(profilePath)) continue
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'))
    if (profile.compatibility === override.compatibility && profile.tested === override.tested) continue
    profile.compatibility = override.compatibility
    profile.tested = override.tested
    if (!profile.testedAt) profile.testedAt = now
    writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')
  }

  // Build full results file
  const allResults = { ...existingResults }
  for (const r of results) {
    allResults[r.id] = { ...r, testedAt: now }
  }
  // Include overrides in results
  for (const [id, override] of Object.entries(overrides)) {
    if (!allResults[id]) {
      allResults[id] = { id, ...override, testedAt: now }
    }
  }

  const summary = {
    lastRun: now,
    totalTested: Object.keys(allResults).length,
    working: Object.values(allResults).filter(r => r.compatibility === 'working').length,
    broken: Object.values(allResults).filter(r => r.compatibility === 'broken').length,
    results: allResults,
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2) + '\n')
  console.log(`\nWrote ${RESULTS_FILE}`)
  console.log('Updated profile.json files with compatibility tags.')

  // Exit with error if any newly tested specs are broken (useful for CI)
  if (broken.length > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(2)
})
