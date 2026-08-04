import { main } from './cli.js';

await main(['admin', 'invite', 'revoke', ...Bun.argv.slice(2)]);
