import { setupServer } from 'msw/node'
import { snapshot } from 'msw-snapshot'

export const mswServer = setupServer(
  snapshot({
    basePath: './test/snapshots/',
    updateSnapshots: 'missing'
  })
)
