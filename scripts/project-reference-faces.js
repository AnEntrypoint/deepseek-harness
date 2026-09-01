/** Validate compiler-face isolation across workspace Project Reference graphs. */

import { existsSync, globSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const WORKSPACE_MANIFESTS = [
  'packages/*/*/package.json',
  'apps/*/package.json',
  'vendor/*/package.json',
]

/**
 * Find references that enter the wrong leaf of a split Host/Client project.
 *
 * A single-config project is neutral and may participate in either graph. Once
 * a package declares both face configs, every reachable reference must name
 * the leaf matching the aggregate from which traversal began.
 *
 * @param root - Repository root containing both aggregate tsconfigs.
 * @returns Repo-relative diagnostics for every mismatched reference edge.
 */
export function collectProjectReferenceFaceViolations(root) {
  const splitRoots = splitProjectRoots(root)
  const violations = []
  const pending = [resolve(root, 'tsconfig.host.json'), resolve(root, 'tsconfig.client.json')]
  const visited = new Set()
  for (let configPath = pending.pop(); configPath !== undefined; configPath = pending.pop()) {
    if (visited.has(configPath) || !existsSync(configPath)) continue
    visited.add(configPath)
    const config = projectConfig(root, configPath)
    const face = projectFace(root, configPath, config)
    for (const reference of projectReferences(config)) {
      const targetConfig = referenceConfigPath(configPath, reference)
      const splitRoot = containingSplitRoot(splitRoots, targetConfig)
      if (splitRoot !== undefined) {
        if (face === undefined) {
          violations.push(
            `${repoPath(root, configPath)}: Project Reference ${JSON.stringify(reference)} enters split project ${repoPath(root, splitRoot)} from a config with no Host/Client face`,
          )
          continue
        }
        const expected = resolve(splitRoot, `tsconfig.${face}.json`)
        if (targetConfig !== expected) {
          violations.push(
            `${repoPath(root, configPath)}: Project Reference ${JSON.stringify(reference)} enters split project ${repoPath(root, splitRoot)} from a ${faceLabel(face)} config; reference ${JSON.stringify(repoPath(root, expected))} instead`,
          )
          continue
        }
      }
      pending.push(targetConfig)
    }
  }

  return violations.sort()
}

function splitProjectRoots(root) {
  return globSync(WORKSPACE_MANIFESTS, { cwd: root })
    .map(manifest => resolve(root, dirname(manifest)))
    .filter(dir => existsSync(resolve(dir, 'tsconfig.host.json'))
      && existsSync(resolve(dir, 'tsconfig.client.json')))
    .sort((left, right) => right.length - left.length)
}

function projectConfig(root, configPath) {
  const read = ts.readConfigFile(configPath, path => ts.sys.readFile(path))
  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, '\n')
    throw new Error(`${repoPath(root, configPath)}: ${message}`)
  }
  return read.config
}

function projectReferences(config) {
  return (config.references ?? [])
    .map(reference => reference.path)
    .filter((path) => typeof path === 'string')
}

function projectFace(
  root,
  configPath,
  config,
  seen = new Set(),
) {
  if (basename(configPath) === 'tsconfig.host.json') return 'host'
  if (basename(configPath) === 'tsconfig.client.json') return 'client'
  if (configPath === resolve(root, 'tsconfig.base.json')) return 'host'
  if (configPath === resolve(root, 'tsconfig.base.client.json')) return 'client'
  if (seen.has(configPath)) return undefined
  seen.add(configPath)
  const parent = localExtendsConfig(configPath, config.extends)
  if (parent === undefined || !existsSync(parent)) return undefined
  return projectFace(root, parent, projectConfig(root, parent), seen)
}

function localExtendsConfig(configPath, value) {
  if (typeof value !== 'string' || !value.startsWith('.')) return undefined
  const target = resolve(dirname(configPath), value)
  return target.endsWith('.json') ? target : `${target}.json`
}

function referenceConfigPath(sourceConfig, reference) {
  const target = resolve(dirname(sourceConfig), reference)
  return target.endsWith('.json') ? target : resolve(target, 'tsconfig.json')
}

function containingSplitRoot(splitRoots, targetConfig) {
  return splitRoots.find((root) => {
    const path = relative(root, targetConfig)
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  })
}

function repoPath(root, path) {
  return relative(root, path).split(sep).join('/')
}

function faceLabel(face) {
  return face === 'host' ? 'Host' : 'Client'
}
