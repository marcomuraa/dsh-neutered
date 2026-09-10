import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

/**
 * The workspace build consumes JavaScript emitted by the Host TypeScript
 * project and runs Typert over the workspace.
 */
export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face !== undefined && face !== 'host') {
    throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host, received ${String(face)}`)
  }
  return {
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    entry: ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
