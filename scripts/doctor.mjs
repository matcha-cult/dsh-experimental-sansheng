#!/usr/bin/env node
/**
 * Pre-install doctor for dsh-experimental-sansheng.
 *
 * The plugin runs inside a DeepSeek Harness profile, so this script can only
 * check the package itself and the declared support matrix. Pass the running
 * host version explicitly:
 *
 *   npm run doctor -- --host-version 0.2.1-rc.2
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const failures = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail === '' ? '' : `: ${detail}`}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const pkg = readJson(join(ROOT, 'package.json'))
const compat = readJson(join(ROOT, 'compatibility.json'))
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map((part) => Number(part))
const nodeVersion = process.versions.node

check('package name', pkg.name === 'dsh-experimental-sansheng', pkg.name)
const sameCompat = compat.version === pkg.version
check('compatibility version matches package', sameCompat, sameCompat ? '' : `${compat.version} != ${pkg.version}`)
check('node >= 22.19', nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 19), nodeVersion)

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'src/policy.js', 'compatibility.json']) {
  const ok = existsSync(join(ROOT, file))
  check(`file ${file}`, ok, ok ? '' : 'missing')
}

const profileDir = join(ROOT, 'preset-bundle')
if (existsSync(join(profileDir, 'package.json'))) {
  const profile = readJson(join(profileDir, 'package.json'))
  const sameVersion = profile.version === pkg.version
  check('companion version matches core', sameVersion, sameVersion ? '' : `${profile.version} != ${pkg.version}`)
  const range = profile.dependencies?.['dsh-experimental-sansheng']
  check('companion depends on this core version', typeof range === 'string' && range.includes(pkg.version.replace(/^(\d+)\.(\d+)\.\d+$/, '$1.$2')), String(range))
}

const hostVersion = arg('--host-version') ?? process.env.DSH_VERSION
if (hostVersion === undefined) {
  results.push({ name: 'host version', ok: true, detail: 'not supplied; pass --host-version to verify the support matrix' })
} else {
  const tested = (compat.testedHosts ?? []).some((entry) => entry.version === hostVersion)
  check(`host ${hostVersion} is in testedHosts`, tested, tested ? 'supported' : 'unsupported host version')
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail === '' ? '' : ` (${result.detail})`}`)
}
if (failures.length > 0) {
  console.error(`\ndoctor failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log('\ndoctor passed')
}
