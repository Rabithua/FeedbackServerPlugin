import { McpServer } from '@modelcontextprotocol/server';
import { registerFeedbackServerTools } from './tools.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'feedback-server',
    version: '0.6.7',
  });
  registerFeedbackServerTools(server);
  return server;
}
