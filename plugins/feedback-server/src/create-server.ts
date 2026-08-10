import { McpServer } from '@modelcontextprotocol/server';
import {
  createPluginUpdateNoticeProvider,
  type UpdateNoticeProvider,
} from './release-updates.js';
import { registerFeedbackServerTools } from './tools.js';
import { PLUGIN_VERSION } from './version.js';

export function createServer(options: {
  updateNoticeProvider?: UpdateNoticeProvider;
} = {}): McpServer {
  const server = new McpServer({
    name: 'feedback-server',
    version: PLUGIN_VERSION,
  });
  registerFeedbackServerTools(
    server,
    undefined,
    options.updateNoticeProvider ?? createPluginUpdateNoticeProvider(),
  );
  return server;
}
