import { preflightNativeCredentialStore } from '../src/credentials.js';

await preflightNativeCredentialStore();
console.error(`FeedbackKit native credential store passed write/read/delete on ${process.platform}.`);
