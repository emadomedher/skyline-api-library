#!/usr/bin/env node
/**
 * Scrapes apitracker.io to populate the Skyline API Library.
 *
 * Steps:
 *   1. Fetch the sitemap to get all API slugs
 *   2. Fetch each slug's JSON page data via Next.js data route
 *   3. Transform into Skyline profile format
 *   4. Write profiles/ dirs and profiles.json catalog
 *
 * Usage:
 *   node scripts/scrape-apitracker.mjs
 *
 * Environment:
 *   CONCURRENCY  — parallel fetch limit (default 20)
 *   DELAY_MS     — ms between batches (default 100)
 *   BUILD_ID     — Next.js build ID override
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20', 10)
const DELAY_MS = parseInt(process.env.DELAY_MS || '100', 10)
const SITEMAP_URL = 'https://apitracker.io/sitemaps/api-tracker/sitemap-api-profiles.xml'
const BASE_DATA_URL = 'https://apitracker.io/_next/data'

// ── Category mapping ──────────────────────────────────────────────
// Maps apitracker's fine-grained categories to our coarser library categories.
const CATEGORY_MAP = {
  // Communication
  'team-messaging': 'Communication',
  'chat': 'Communication',
  'sms': 'Communication',
  'voice': 'Communication',
  'messaging': 'Communication',
  'video-conferencing': 'Communication',
  'voip': 'Communication',
  'unified-communications': 'Communication',
  'webinars': 'Communication',
  'live-chat': 'Communication',
  'customer-support': 'Communication',
  'helpdesk': 'Communication',
  'call-center': 'Communication',
  'contact-center': 'Communication',
  'customer-engagement': 'Communication',
  'notifications': 'Communication',
  'push-notifications': 'Communication',

  // DevOps
  'developer-tools': 'DevOps',
  'code-hosting': 'DevOps',
  'code-editor': 'DevOps',
  'version-control': 'DevOps',
  'continuous-integration': 'DevOps',
  'continuous-deployment': 'DevOps',
  'containers': 'DevOps',
  'infrastructure': 'DevOps',
  'monitoring': 'DevOps',
  'logging': 'DevOps',
  'apm': 'DevOps',
  'observability': 'DevOps',
  'serverless': 'DevOps',
  'api-management': 'DevOps',
  'api-gateway': 'DevOps',
  'api-design': 'DevOps',
  'testing': 'DevOps',
  'developer-documentation': 'DevOps',
  'low-code': 'DevOps',
  'no-code': 'DevOps',

  // Cloud
  'cloud': 'Cloud',
  'cloud-computing': 'Cloud',
  'cloud-infrastructure': 'Cloud',
  'hosting': 'Cloud',
  'paas': 'Cloud',
  'iaas': 'Cloud',
  'cdn': 'Cloud',
  'dns': 'Cloud',

  // Project Management
  'project-management': 'Project Management',
  'task-management': 'Project Management',
  'product-management': 'Project Management',
  'issue-tracking': 'Project Management',
  'agile': 'Project Management',
  'collaboration': 'Project Management',
  'team-collaboration': 'Project Management',
  'documents': 'Project Management',
  'notes': 'Project Management',
  'knowledge-base': 'Project Management',
  'wiki': 'Project Management',

  // Email
  'email': 'Email',
  'email-marketing': 'Email',
  'transactional-email': 'Email',
  'email-verification': 'Email',
  'newsletters': 'Email',

  // CRM
  'crm': 'CRM',
  'sales': 'CRM',
  'sales-enablement': 'CRM',
  'lead-generation': 'CRM',
  'lead-management': 'CRM',
  'sales-intelligence': 'CRM',
  'customer-success': 'CRM',

  // Payments & Finance
  'payments': 'Payments',
  'payment-processing': 'Payments',
  'billing': 'Payments',
  'invoicing': 'Payments',
  'subscription-management': 'Payments',
  'fintech': 'Payments',
  'banking': 'Payments',
  'open-banking': 'Payments',
  'cryptocurrency': 'Payments',
  'fx-payments': 'Payments',

  // Accounting
  'accounting': 'Accounting',
  'bookkeeping': 'Accounting',
  'expenses': 'Accounting',
  'tax': 'Accounting',
  'payroll': 'Accounting',

  // HR
  'hr': 'HR',
  'hris': 'HR',
  'recruitment': 'HR',
  'ats': 'HR',
  'talent-management': 'HR',
  'employee-engagement': 'HR',
  'performance-management': 'HR',
  'onboarding': 'HR',
  'workforce-management': 'HR',

  // E-commerce
  'ecommerce': 'E-commerce',
  'e-commerce': 'E-commerce',
  'shopping-cart': 'E-commerce',
  'marketplace': 'E-commerce',
  'retail': 'E-commerce',
  'order-management': 'E-commerce',
  'inventory-management': 'E-commerce',
  'shipping': 'E-commerce',
  'logistics': 'E-commerce',
  'supply-chain': 'E-commerce',

  // Marketing
  'marketing': 'Marketing',
  'marketing-automation': 'Marketing',
  'advertising': 'Marketing',
  'display-and-programmatic-advertising': 'Marketing',
  'seo': 'Marketing',
  'content-marketing': 'Marketing',
  'social-media-marketing-and-monitoring': 'Marketing',
  'affiliate-marketing': 'Marketing',
  'influencer-marketing': 'Marketing',
  'abm': 'Marketing',
  'demand-generation': 'Marketing',

  // Storage
  'storage': 'Storage',
  'cloud-storage': 'Storage',
  'files': 'Storage',
  'backup': 'Storage',
  'database': 'Storage',
  'data-warehouse': 'Storage',

  // AI & ML
  'ai': 'AI & ML',
  'artificial-intelligence': 'AI & ML',
  'machine-learning': 'AI & ML',
  'nlp': 'AI & ML',
  'computer-vision': 'AI & ML',
  'chatbot': 'AI & ML',
  'conversational-ai': 'AI & ML',
  'speech-recognition': 'AI & ML',
  'text-to-speech': 'AI & ML',
  'generative-ai': 'AI & ML',

  // Analytics
  'analytics': 'Analytics',
  'data-analytics': 'Analytics',
  'business-intelligence': 'Analytics',
  'data-visualization': 'Analytics',
  'customer-data-platforms': 'Analytics',
  'attribution': 'Analytics',
  'ab-testing': 'Analytics',
  'product-analytics': 'Analytics',
  'web-analytics': 'Analytics',

  // Social Media
  'social-media': 'Social Media',
  'social': 'Social Media',
  'social-network': 'Social Media',
  'social-media-platforms': 'Social Media',
  'social-media-management': 'Social Media',

  // Security & Auth
  'authentication': 'Security',
  'identity': 'Security',
  'identity-management': 'Security',
  'security': 'Security',
  'cybersecurity': 'Security',
  'fraud-detection': 'Security',
  'compliance': 'Security',
  'encryption': 'Security',
  'sso': 'Security',

  // ERP
  'erp': 'ERP',
  'enterprise-resource-planning': 'ERP',

  // Healthcare
  'healthcare': 'Healthcare',
  'health-tech': 'Healthcare',
  'telemedicine': 'Healthcare',
  'ehr': 'Healthcare',
  'life-sciences': 'Healthcare',

  // Education
  'education': 'Education',
  'lms': 'Education',
  'e-learning': 'Education',
  'edtech': 'Education',

  // Real Estate
  'real-estate': 'Real Estate',
  'property-management': 'Real Estate',
  'proptech': 'Real Estate',

  // Media
  'video': 'Media',
  'video-cms': 'Media',
  'audio': 'Media',
  'streaming': 'Media',
  'podcasting': 'Media',
  'cms': 'Media',
  'digital-asset-management': 'Media',

  // Design
  'design': 'Design',
  'design-version-control': 'Design',
  'diagramming': 'Design',
  'presentations': 'Design',
  'graphic-design': 'Design',

  // Travel & Hospitality
  'travel': 'Travel',
  'hospitality': 'Travel',
  'booking': 'Travel',
  'hotel': 'Travel',

  // Legal
  'legal': 'Legal',
  'legal-tech': 'Legal',
  'contract-management': 'Legal',
  'e-signature': 'Legal',

  // Integration
  'integration-platform': 'Integration',
  'unified-apis': 'Integration',
  'ipaas': 'Integration',
  'etl': 'Integration',
  'data-integration': 'Integration',

  // Maps & Location
  'maps': 'Maps & Geolocation',
  'geolocation': 'Maps & Geolocation',
  'geocoding': 'Maps & Geolocation',
  'location': 'Maps & Geolocation',

  // IoT
  'iot': 'IoT',
  'internet-of-things': 'IoT',
  'smart-home': 'IoT',

  // Government
  'government': 'Government',
  'govtech': 'Government',
  'open-data': 'Open Data',

  // Gaming
  'gaming': 'Gaming',
  'game-development': 'Gaming',

  // Forms & Surveys
  'forms': 'Forms & Surveys',
  'surveys': 'Forms & Surveys',

  // Scheduling
  'scheduling': 'Scheduling',
  'calendar': 'Scheduling',
  'appointment-scheduling': 'Scheduling',
  'booking-engine': 'Scheduling',

  // Telecom
  'telecommunications': 'Telecom',
  'telecom': 'Telecom',

  // Insurance
  'insurance': 'Insurance',
  'insurtech': 'Insurance',

  // Data & Enrichment
  'data-enrichment': 'Data',
  'data': 'Data',
  'web-scraping': 'Data',
  'data-management': 'Data',

  // Productivity
  'productivity': 'Productivity',
  'spreadsheets': 'Productivity',
  'automation': 'Productivity',
  'workflow-automation': 'Productivity',
  'rpa': 'Productivity',
}

// ── Helpers ───────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Skyline-API-Library-Builder/1.0' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Skyline-API-Library-Builder/1.0' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

/** Extract slugs from the sitemap XML */
function parseSlugs(xml) {
  const slugs = []
  const re = /<loc>https:\/\/apitracker\.io\/a\/([^<]+)<\/loc>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    slugs.push(m[1])
  }
  return slugs
}

/** Get the Next.js build ID from the homepage */
async function getBuildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID
  const html = await fetchText('https://apitracker.io')
  const m = html.match(/"buildId"\s*:\s*"([^"]+)"/)
  if (!m) throw new Error('Could not extract buildId from apitracker.io')
  return m[1]
}

/** Map apitracker categories to our library category */
function mapCategory(categories) {
  if (!categories || categories.length === 0) return 'Other'
  for (const cat of categories) {
    const id = cat.id || cat
    const mapped = CATEGORY_MAP[id]
    if (mapped) return mapped
  }
  // Try the name as fallback
  for (const cat of categories) {
    const name = (cat.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const mapped = CATEGORY_MAP[name]
    if (mapped) return mapped
  }
  return 'Other'
}

/** Infer specType from a spec entry */
function inferSpecType(spec) {
  const t = (spec.type || '').toLowerCase()
  if (t === 'openapi') return spec.specVersion?.startsWith('2') ? 'swagger2' : 'openapi'
  if (t === 'swagger') return 'swagger2'
  if (t === 'graphql') return 'graphql'
  if (t === 'asyncapi') return 'asyncapi'
  if (t === 'raml') return 'raml'
  if (t === 'wsdl') return 'wsdl'
  if (t === 'postman') return 'postman'
  if (t === 'grpc') return 'grpc'
  if (t === 'odata') return 'odata'
  return 'auto-detect'
}

/** Infer auth type from page data */
function inferAuth(pageData) {
  // Check if there's any OAuth info
  const desc = JSON.stringify(pageData).toLowerCase()
  if (desc.includes('oauth2') || desc.includes('oauth 2')) return 'oauth2'
  if (desc.includes('api-key') || desc.includes('api_key') || desc.includes('apikey')) return 'api-key'
  if (desc.includes('bearer')) return 'bearer'
  if (desc.includes('basic auth')) return 'basic'
  return 'api-key' // safe default for most SaaS APIs
}

/** Generate a kebab-case id from a slug */
function slugToId(slug) {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/** Build profile from apitracker pageData */
function buildProfile(slug, data) {
  const pd = data.pageProps?.pageData
  if (!pd) return null

  const id = slugToId(slug)
  const name = pd.name || slug
  const description = pd.description || `${name} API integration`
  const subtitle = description.length > 120 ? description.slice(0, 117) + '...' : description
  const icon = pd.icon || pd.favicon || ''
  const categories = pd.categories || []
  const category = mapCategory(categories)
  const website = pd.websiteUrl || ''
  const docsUrl = pd.developerPortalUrl || pd.apiReferenceUrl || ''

  // Collect tags from categories
  const tags = [...new Set(
    categories.map(c => (c.name || c.id || '').toLowerCase().replace(/\s+/g, '-')).filter(Boolean)
  )]
  if (tags.length === 0) tags.push(category.toLowerCase().replace(/\s+/g, '-'))

  // Find best spec
  const allSpecs = data.pageProps?.apiSpecs || []
  const apis = pd.apis || []

  // Also gather specs from apis[].specs
  for (const api of apis) {
    if (api.specs) {
      for (const s of api.specs) {
        allSpecs.push(s)
      }
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set()
  const uniqueSpecs = []
  for (const s of allSpecs) {
    if (s.url && !seenUrls.has(s.url)) {
      seenUrls.add(s.url)
      uniqueSpecs.push(s)
    }
  }

  // Pick primary spec (prefer official, then openapi, then any)
  let primarySpec = uniqueSpecs.find(s => s.official) || uniqueSpecs.find(s => s.type === 'openapi') || uniqueSpecs[0]

  // Build base URL from first API entry
  let baseUrl = ''
  for (const api of apis) {
    if (api.baseUrl) { baseUrl = api.baseUrl; break }
  }

  const authType = inferAuth(pd)

  const profile = {
    id,
    title: name,
    subtitle,
    tags,
    category,
    specType: primarySpec ? inferSpecType(primarySpec) : 'auto-detect',
    authType,
  }

  if (icon) profile.logo = icon
  if (primarySpec?.url) profile.specUrl = primarySpec.url
  if (baseUrl) profile.baseUrl = baseUrl
  if (website) profile.website = website
  if (docsUrl) profile.docsUrl = docsUrl

  // Additional specs beyond the primary
  const additionalSpecs = uniqueSpecs.filter(s => s !== primarySpec && s.url)
  if (additionalSpecs.length > 0) {
    profile.additionalSpecUrls = additionalSpecs.map(s => ({
      label: s.label || `${name} (${s.type || 'API'})`,
      specUrl: s.url,
      specType: inferSpecType(s),
    }))
  }

  return profile
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== Skyline API Library Scraper ===\n')

  // 1. Get build ID
  console.log('Fetching build ID...')
  const buildId = await getBuildId()
  console.log(`Build ID: ${buildId}\n`)

  // 2. Fetch sitemap and extract slugs
  console.log('Fetching sitemap...')
  const sitemapXml = await fetchText(SITEMAP_URL)
  const slugs = parseSlugs(sitemapXml)
  console.log(`Found ${slugs.length} API slugs\n`)

  // 3. Fetch all API data in batches
  console.log(`Fetching API data (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms)...\n`)
  const profiles = []
  const errors = []
  let fetched = 0

  for (let i = 0; i < slugs.length; i += CONCURRENCY) {
    const batch = slugs.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (slug) => {
        const url = `${BASE_DATA_URL}/${buildId}/a/${slug}.json`
        const data = await fetchJSON(url)
        return { slug, data }
      })
    )

    for (const result of results) {
      fetched++
      if (result.status === 'fulfilled') {
        const { slug, data } = result.value
        const profile = buildProfile(slug, data)
        if (profile) {
          profiles.push(profile)
        }
      } else {
        errors.push(result.reason.message)
      }
    }

    // Progress
    if (fetched % 200 === 0 || fetched === slugs.length) {
      console.log(`  ${fetched}/${slugs.length} fetched, ${profiles.length} profiles, ${errors.length} errors`)
    }

    if (i + CONCURRENCY < slugs.length) {
      await sleep(DELAY_MS)
    }
  }

  console.log(`\nFetch complete: ${profiles.length} profiles, ${errors.length} errors\n`)

  // 4. Merge with existing hand-crafted profiles (they take priority)
  const existingCatalogPath = join(ROOT, 'profiles.json')
  let existingIds = new Set()
  if (existsSync(existingCatalogPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingCatalogPath, 'utf-8'))
      existingIds = new Set(existing.profiles.map(p => p.id))
      console.log(`Preserving ${existingIds.size} existing hand-crafted profiles`)
    } catch { /* ignore */ }
  }

  // Filter out profiles that conflict with existing hand-crafted ones
  const newProfiles = profiles.filter(p => !existingIds.has(p.id))
  console.log(`Adding ${newProfiles.length} new profiles from apitracker.io\n`)

  // 5. Write individual profile files
  console.log('Writing profile files...')
  for (const profile of newProfiles) {
    const dir = join(ROOT, 'profiles', profile.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify(profile, null, 2) + '\n'
    )
  }

  // 6. Build catalog index
  // Re-read existing profiles to merge
  let allCatalogEntries = []
  if (existsSync(existingCatalogPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingCatalogPath, 'utf-8'))
      allCatalogEntries = existing.profiles
    } catch { /* ignore */ }
  }

  // Add new entries
  for (const profile of newProfiles) {
    allCatalogEntries.push({
      id: profile.id,
      title: profile.title,
      subtitle: profile.subtitle,
      logo: profile.logo || '',
      tags: profile.tags,
      category: profile.category,
      authType: profile.authType,
      selfHostable: false,
      profilePath: `profiles/${profile.id}/profile.json`,
    })
  }

  // Sort alphabetically
  allCatalogEntries.sort((a, b) => a.title.localeCompare(b.title))

  const catalog = {
    version: 1,
    generated_at: new Date().toISOString(),
    total: allCatalogEntries.length,
    profiles: allCatalogEntries,
  }

  writeFileSync(existingCatalogPath, JSON.stringify(catalog, null, 2) + '\n')
  console.log(`\nWrote profiles.json with ${allCatalogEntries.length} total entries`)

  // 7. Summary stats
  const categories = {}
  const withSpec = allCatalogEntries.filter(p => {
    const full = newProfiles.find(n => n.id === p.id)
    return full?.specUrl
  })
  for (const p of allCatalogEntries) {
    categories[p.category] = (categories[p.category] || 0) + 1
  }

  console.log(`\n=== Summary ===`)
  console.log(`Total profiles: ${allCatalogEntries.length}`)
  console.log(`With spec URL: ${withSpec.length}`)
  console.log(`\nBy category:`)
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1])
  for (const [cat, count] of sorted) {
    console.log(`  ${cat}: ${count}`)
  }

  if (errors.length > 0) {
    console.log(`\n${errors.length} errors (first 10):`)
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${err}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
