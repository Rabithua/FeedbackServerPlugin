import { McpServer } from '@modelcontextprotocol/server';
import {
  createPluginUpdateNoticeProvider,
  type UpdateNoticeProvider,
} from './release-updates.js';
import {
  createSetupNoticeProvider,
  type SetupNoticeProvider,
} from './onboarding.js';
import { registerFeedbackServerTools } from './tools.js';
import { PLUGIN_VERSION } from './version.js';

export function createServer(options: {
  updateNoticeProvider?: UpdateNoticeProvider;
  setupNoticeProvider?: SetupNoticeProvider;
} = {}): McpServer {
  const server = new McpServer({
    name: 'feedback-server',
    version: PLUGIN_VERSION,
  });
  registerFeedbackServerTools(
    server,
    undefined,
    options.updateNoticeProvider ?? createPluginUpdateNoticeProvider(),
    options.setupNoticeProvider ?? createSetupNoticeProvider(),
  );
  return server;
}
