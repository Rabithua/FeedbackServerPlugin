import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const bundlePath = new URL('../dist/server.mjs', import.meta.url).pathname;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundlePath],
  env: {
    FEEDBACK_SERVER_BASE_URL: 'https://feedback.example.com/v1/api',
    FEEDBACK_SERVER_API_TOKEN: `fspat_${'s'.repeat(64)}`,
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'feedback-server-stdio-smoke', version: '0.11.1' });

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  if (tools.length !== 71) {
    throw new Error(`Expected 71 FeedbackServer tools, received ${tools.length}`);
  }
  if (!tools.some(({ name }) => name === 'connection_status')) {
    throw new Error('FeedbackServer stdio bundle is missing connection_status');
  }
  if (!tools.some(({ name }) => name === 'get_onboarding_status')) {
    throw new Error('FeedbackServer stdio bundle is missing get_onboarding_status');
  }
  console.error('FeedbackServer stdio bundle initialized with 71 tools.');
} finally {
  await client.close();
}
