/**
 * Configuration normalization for workspace instruction discovery and rendering.
 *
 * @module @deepseek-ai/dsh-agent-instructions/config
 */

import { relative } from 'node:path'
import z from '@deepseek-ai/schemastery'

const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const
const DEFAULT_MAX_SOURCE_BYTES = 1_048_576

/**
 * The only file name read as workspace instructions. Every directory from the
 * project root down to the session cwd may hold one; no other name, overlay
 * file or user-global file is probed, and the name is not configurable.
 */
export const INSTRUCTION_FILE = 'DSH_INSTRUCTIONS.md'

/** User-facing workspace instruction loader configuration. */
export interface Config {
  /** Directory entries that identify the project root while walking upward from the session cwd. */
  projectRootMarkers?: string[]
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  maxSourceBytes?: number
}

export const Config: z<Config> = z.object({
  projectRootMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_ROOT_MARKERS]),
  maxBytes: z.number().required(),
  maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
})

/** Normalized instruction discovery configuration. */
export interface ResolvedDiscoveryConfig {
  projectRootMarkers: string[]
}

/** Normalized configuration used by discovery and reconciliation. */
export interface ResolvedConfig extends ResolvedDiscoveryConfig {
  maxBytes: number
  maxSourceBytes: number
}

/**
 * Identify the discovery and budget semantics of one baseline.
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @param projectRoot - project root selected for the current baseline.
 * @returns stable serialized identity for compatibility checks on resume.
 */
export function workspaceBaselineIdentity(
  config: ResolvedConfig,
  cwd: string,
  projectRoot: string,
): string {
  return JSON.stringify({
    projectRoot: relative(cwd, projectRoot),
    projectRootMarkers: config.projectRootMarkers,
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes,
  })
}

/**
 * Resolve defaults for discovery and the byte caps.
 * @param config - user-facing plugin configuration.
 * @returns normalized runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    ...resolveDiscoveryConfig(config),
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
  }
}

/**
 * Resolve the subset of configuration used before instruction content is rendered.
 * @param config - optional discovery controls.
 * @returns normalized root markers.
 */
export function resolveDiscoveryConfig(config: Pick<Config, 'projectRootMarkers'>): ResolvedDiscoveryConfig {
  return {
    projectRootMarkers: config.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS],
  }
}
