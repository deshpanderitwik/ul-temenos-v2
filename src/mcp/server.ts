import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { initDb } from '../main/yjs/db'
import {
  listNarratives,
  getNarrative,
  createNarrative,
  appendUpdate,
  loadDoc,
  updateNarrativeMeta
} from '../main/yjs/persistence'
import {
  textToTipTapDoc,
  textToTipTapDocWithTitle,
  tipTapDocToText,
  appendToTipTapDoc
} from './tiptap-json'
import { applyContentReplacement, docToTipTapJSON } from './yjs-mcp-bridge'

// Initialize the SQLite store at the same path the desktop app uses. The MCP
// server and app share the file via WAL — concurrent reads are fine, writes
// serialize via SQLite transactions.
//
// If better-sqlite3 fails to load with a NODE_MODULE_VERSION error, the
// native binary is currently compiled for Electron rather than Node. Run
// `npm run rebuild:node` once before `npm run mcp:dev`; rerun
// `npm run rebuild:native` before launching the desktop app again. Turn 8
// or later will likely consolidate this.
try {
  initDb()
} catch (err) {
  console.error('[mcp] failed to open SQLite — see comment above for the')
  console.error('[mcp] native-module rebuild dance. Underlying error:')
  console.error(err)
  process.exit(1)
}

const server = new McpServer({
  name: 'temenos',
  version: '2.0.0'
})

server.tool(
  'list_narratives',
  'List all narratives with their IDs and titles, sorted by most recently updated',
  {},
  async () => {
    const entries = listNarratives()
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'No narratives found.' }] }
    }
    const lines = entries.map(
      (e) => `• ${e.title}  [id: ${e.id}]  (updated: ${e.updatedAt})`
    )
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

server.tool(
  'get_narrative',
  'Get the full content of a narrative by ID',
  { id: z.string().describe('The narrative UUID') },
  async ({ id }) => {
    const meta = getNarrative(id)
    if (!meta) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }
    const doc = loadDoc(id)
    const json = docToTipTapJSON(doc)
    const text = tipTapDocToText(json as Record<string, unknown>)
    return {
      content: [{ type: 'text', text: `# ${meta.title}\n\n${text}` }]
    }
  }
)

server.tool(
  'create_narrative',
  'Create a new narrative with optional title and content',
  {
    title: z
      .string()
      .optional()
      .describe('Title for the narrative (default: "Untitled")'),
    content: z.string().optional().describe('Initial text content for the narrative')
  },
  async ({ title, content }) => {
    const narrativeTitle = title ?? 'Untitled'
    const created = createNarrative({ title: narrativeTitle })

    const initialJson =
      title && content
        ? textToTipTapDocWithTitle(title, content)
        : title
          ? textToTipTapDocWithTitle(title, '')
          : content
            ? textToTipTapDoc(content)
            : null

    if (initialJson) {
      const doc = loadDoc(created.id)
      const update = applyContentReplacement(doc, initialJson)
      appendUpdate(created.id, update)
    }

    return {
      content: [
        {
          type: 'text',
          text: `Created narrative "${narrativeTitle}" with id: ${created.id}`
        }
      ]
    }
  }
)

server.tool(
  'append_to_narrative',
  'Append text to an existing narrative',
  {
    id: z.string().describe('The narrative UUID'),
    content: z.string().describe('Text content to append')
  },
  async ({ id, content }) => {
    const meta = getNarrative(id)
    if (!meta) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }

    const doc = loadDoc(id)
    const currentJson = docToTipTapJSON(doc)
    const updatedJson = appendToTipTapDoc(
      currentJson as Record<string, unknown>,
      content
    )
    const update = applyContentReplacement(doc, updatedJson)
    appendUpdate(id, update)

    return {
      content: [{ type: 'text', text: `Appended content to "${meta.title}"` }]
    }
  }
)

server.tool(
  'update_narrative',
  'Replace the full content of an existing narrative',
  {
    id: z.string().describe('The narrative UUID'),
    title: z.string().optional().describe('New title (keeps existing if omitted)'),
    content: z.string().describe('New text content (replaces existing content)')
  },
  async ({ id, title, content }) => {
    const meta = getNarrative(id)
    if (!meta) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }

    const newJson = textToTipTapDoc(content)
    const doc = loadDoc(id)
    const update = applyContentReplacement(doc, newJson)
    appendUpdate(id, update)

    if (title && title !== meta.title) {
      updateNarrativeMeta(id, { title })
    }

    return {
      content: [
        { type: 'text', text: `Updated "${title ?? meta.title}"` }
      ]
    }
  }
)

const transport = new StdioServerTransport()
server.connect(transport).catch((err) => {
  console.error('Failed to start MCP server:', err)
  process.exit(1)
})
