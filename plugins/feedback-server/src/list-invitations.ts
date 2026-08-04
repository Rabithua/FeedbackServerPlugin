import { main } from './cli.js';

await main(['admin', 'invitations', ...Bun.argv.slice(2)]);
