import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './create-server.js';

void serveStdio(() => createServer());
console.error('FeedbackServer MCP server running on stdio');
