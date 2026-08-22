import {
  createAgentToken,
  login,
  logout,
  revokeAgentToken,
} from '../src/admin-session.js';
import { FeedbackServerApiClient } from '../src/api-client.js';
import type { StoredCredentials } from '../src/credentials.js';
import {
  acceptInvitationAndConfigure,
  type InvitationAcceptanceDependencies,
} from '../src/invitation-acceptance.js';
import {
  createShareableInvitation,
  getInvitations,
  revokeInvitationById,
  type InvitationAdministrationDependencies,
} from '../src/invitation-administration.js';
import {
  acceptAdminInvitation,
  createAdminInvitation,
  listAdminInvitations,
  listOwnedProducts,
  revokeAdminInvitation,
} from '../src/invitation-api.js';

const baseUrl = process.env.FEEDBACK_SERVER_CONTRACT_URL;
const superAdminUsername = process.env.FEEDBACK_SERVER_CONTRACT_USERNAME;
const superAdminPassword = process.env.FEEDBACK_SERVER_CONTRACT_PASSWORD;
if (!baseUrl || !superAdminUsername || !superAdminPassword) {
  throw new Error(
    'FEEDBACK_SERVER_CONTRACT_URL, FEEDBACK_SERVER_CONTRACT_USERNAME, and FEEDBACK_SERVER_CONTRACT_PASSWORD are required',
  );
}

const invitationDependencies: InvitationAdministrationDependencies = {
  login,
  logout,
  createInvitation: createAdminInvitation,
  listInvitations: listAdminInvitations,
  revokeInvitation: revokeAdminInvitation,
  clipboard: {
    write: () => Promise.resolve(),
    clearIfUnchanged: () => Promise.resolve(true),
  },
};

const first = await createShareableInvitation(
  {
    baseUrl,
    superAdminUsername,
    superAdminPassword,
    expiresInDays: 1,
    subscriptionGrant: { plan: 'solo', term: 'month' },
  },
  () => Promise.resolve(),
  invitationDependencies,
);
if (!first.clipboardCleared) throw new Error('Contract clipboard was not cleared');

let stored: StoredCredentials | undefined;
const acceptanceDependencies: InvitationAcceptanceDependencies = {
  isMacOS: () => true,
  readCredentials: () => Promise.resolve(undefined),
  writeCredentials: (credentials) => {
    stored = credentials;
    return Promise.resolve();
  },
  acceptInvitation: acceptAdminInvitation,
  login,
  listProducts: listOwnedProducts,
  createToken: createAgentToken,
  revokeToken: revokeAgentToken,
  logout,
  readPendingRevocations: () => Promise.resolve([]),
  addPendingRevocation: () => Promise.resolve(),
  removePendingRevocation: () => Promise.resolve(),
};
const suffix = crypto.randomUUID().slice(0, 8);
const username = `contract-${suffix}`;
const credentials = await acceptInvitationAndConfigure(
  {
    baseUrl,
    token: first.invitation.token,
    username,
    displayName: `Contract ${suffix}`,
    password: `contract-password-${suffix}-safe`,
  },
  acceptanceDependencies,
);
if (stored?.token !== credentials.credentials.token) {
  throw new Error('Contract PAT was not persisted');
}
if (credentials.subscription.plan !== 'solo' || credentials.subscription.term !== 'fixed') {
  throw new Error('Contract invitation subscription grant was not applied');
}
const client = new FeedbackServerApiClient(credentials.credentials);
const products = await client.request<unknown[]>('/admin/products');
if (products.length !== 0) throw new Error('Contract administrator unexpectedly owns Products');

const accepted = await getInvitations(
  { baseUrl, superAdminUsername, superAdminPassword },
  invitationDependencies,
);
if (accepted.find((entry) => entry.id === first.invitation.id)?.status !== 'accepted') {
  throw new Error('Accepted invitation did not reach accepted status');
}

const second = await createShareableInvitation(
  { baseUrl, superAdminUsername, superAdminPassword, expiresInDays: 1 },
  () => Promise.resolve(),
  invitationDependencies,
);
await revokeInvitationById(
  {
    baseUrl,
    superAdminUsername,
    superAdminPassword,
    invitationId: second.invitation.id,
  },
  invitationDependencies,
);
let revokedRejected = false;
try {
  await acceptAdminInvitation(baseUrl, {
    token: second.invitation.token,
    username: `revoked-${suffix}`,
    displayName: 'Revoked Contract',
    password: `revoked-password-${suffix}-safe`,
  });
} catch {
  revokedRejected = true;
}
if (!revokedRejected) throw new Error('Revoked invitation was accepted');

console.error('FeedbackServer invitation and Agent configuration contract passed.');
