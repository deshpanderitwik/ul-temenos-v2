import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as store from '../main/store'
import { textToTipTapDoc, textToTipTapDocWithTitle, tipTapDocToText, appendToTipTapDoc } from './tiptap-json'

store.ensureStoreDir()

const server = new McpServer({
  name: 'temenos',
  version: '1.0.0'
})

server.tool(
  'list_narratives',
  'List all narratives with their IDs and titles, sorted by most recently updated',
  {},
  async () => {
    const entries = store.listNarratives()
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'No narratives found.' }] }
    }
    const lines = entries.map((e) => `• ${e.title}  [id: ${e.id}]  (updated: ${e.updatedAt})`)
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

server.tool(
  'get_narrative',
  'Get the full content of a narrative by ID',
  { id: z.string().describe('The narrative UUID') },
  async ({ id }) => {
    const narrative = store.getNarrative(id)
    if (!narrative) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }
    const text = tipTapDocToText(narrative.content as Record<string, unknown>)
    return {
      content: [{ type: 'text', text: `# ${narrative.title}\n\n${text}` }]
    }
  }
)

server.tool(
  'create_narrative',
  'Create a new narrative with optional title and content',
  {
    title: z.string().optional().describe('Title for the narrative (default: "Untitled")'),
    content: z.string().optional().describe('Initial text content for the narrative')
  },
  async ({ title, content }) => {
    const narrativeTitle = title ?? 'Untitled'
    const { narrativeId } = store.createNarrative(narrativeTitle)

    const doc = title && content
      ? textToTipTapDocWithTitle(title, content)
      : title
        ? textToTipTapDocWithTitle(title, '')
        : content
          ? textToTipTapDoc(content)
          : null

    if (doc) {
      store.updateDraft(narrativeId, doc, narrativeTitle)
    }

    return {
      content: [{ type: 'text', text: `Created narrative "${narrativeTitle}" with id: ${narrativeId}` }]
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
    const narrative = store.getNarrative(id)
    if (!narrative) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }

    const updatedDoc = appendToTipTapDoc(
      narrative.content as Record<string, unknown>,
      content
    )
    store.updateDraft(id, updatedDoc, narrative.title)

    return {
      content: [{ type: 'text', text: `Appended content to "${narrative.title}"` }]
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
    const narrative = store.getNarrative(id)
    if (!narrative) {
      return { content: [{ type: 'text', text: `Narrative ${id} not found.` }] }
    }

    const doc = textToTipTapDoc(content)
    store.updateDraft(id, doc, title ?? narrative.title)

    return {
      content: [{ type: 'text', text: `Updated "${title ?? narrative.title}"` }]
    }
  }
)

const transport = new StdioServerTransport()
server.connect(transport).catch((err) => {
  console.error('Failed to start MCP server:', err)
  process.exit(1)
})
