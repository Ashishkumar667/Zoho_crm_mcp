// const express = require('express');
// const { URL } = require('url');
// const dotenv = require('dotenv');
// const { z } = require('zod');
// const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
// const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

// const SERVER_NAME = 'zoho-mcp';
// const SERVER_VERSION = '1.1.0';

// dotenv.config();

// const app = express();
// app.use(express.json());

// //helper 
// function env(name, fallback = undefined) {
//   return process.env[name] || fallback;
// }

// function getConfigValue(name, fallback = undefined) {
//   const v = process.env[name];
//   return v !== undefined && v !== '' ? v : fallback;
// }

// function stripLeadingSlash(value = '') {
//   return String(value).replace(/^\/+/, '');
// }

// function normalizeMethod(method = 'GET') {
//   return String(method || 'GET').toUpperCase();
// }

// function buildUrl(baseUrl, requestPath, query = {}) {
//   const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${stripLeadingSlash(requestPath)}`);
//   for (const [key, value] of Object.entries(query || {})) {
//     if (value === undefined || value === null) continue;
//     if (Array.isArray(value)) {
//       for (const item of value) url.searchParams.append(key, String(item));
//       continue;
//     }
//     url.searchParams.set(key, String(value));
//   }
//   return url.toString();
// }

// //zoho auth
// function resolveZohoConfig() {
//   const dataCenter = getConfigValue('ZOHO_DATA_CENTER', 'com');
//   return {
//     dataCenter,
//     accountsBaseUrl: getConfigValue('ZOHO_ACCOUNTS_BASE_URL', `https://accounts.zoho.${dataCenter}`),
//     crmBaseUrl:      getConfigValue('ZOHO_CRM_BASE_URL',      `https://www.zohoapis.${dataCenter}/crm/v6`),
//     mailBaseUrl:     getConfigValue('ZOHO_MAIL_BASE_URL',     `https://mail.zoho.${dataCenter}/api`),
//     clientId:        getConfigValue('ZOHO_CLIENT_ID'),
//     clientSecret:    getConfigValue('ZOHO_CLIENT_SECRET'),
//     refreshToken:    getConfigValue('ZOHO_REFRESH_TOKEN'),
//     crmAccessToken:  env('ZOHO_CRM_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
//     mailAccessToken: env('ZOHO_MAIL_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
//   };
// }

// async function refreshZohoAccessToken(config, product) {
//   if (!config.clientId || !config.clientSecret || !config.refreshToken) {
//     throw new Error(
//       `Missing Zoho ${product} credentials. Set ZOHO_${product.toUpperCase()}_ACCESS_TOKEN or ZOHO_ACCESS_TOKEN, ` +
//       `or set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in env.`
//     );
//   }
//   const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
//   const body = new URLSearchParams({
//     grant_type:    'refresh_token',
//     client_id:     config.clientId,
//     client_secret: config.clientSecret,
//     refresh_token: config.refreshToken,
//   });
//   const response = await fetch(tokenUrl, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: body.toString(),
//   });
//   const payload = await response.json().catch(() => ({}));
//   if (!response.ok || !payload.access_token) {
//     throw new Error(`Zoho token refresh failed: ${JSON.stringify(payload)}`);
//   }
//   return payload.access_token;
// }

// async function exchangeZohoAuthorizationCode({ accountsBaseUrl, clientId, clientSecret, redirectUri, code }) {
//   if (!clientId || !clientSecret || !redirectUri || !code) {
//     throw new Error('Missing clientId, clientSecret, redirectUri, or code.');
//   }
//   const tokenUrl = `${accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
//   const body = new URLSearchParams({
//     grant_type:    'authorization_code',
//     client_id:     clientId,
//     client_secret: clientSecret,
//     redirect_uri:  redirectUri,
//     code,
//   });
//   const response = await fetch(tokenUrl, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: body.toString(),
//   });
//   const payload = await response.json().catch(() => ({}));
//   if (!response.ok) throw new Error(`Zoho authorization code exchange failed: ${JSON.stringify(payload)}`);
//   return payload;
// }

// async function getZohoAccessToken(product) {
//   const config = resolveZohoConfig();
//   const directToken = product === 'crm' ? config.crmAccessToken : config.mailAccessToken;
//   if (directToken) return { token: directToken, config, source: 'env access token' };
//   const refreshedToken = await refreshZohoAccessToken(config, product);
//   return { token: refreshedToken, config, source: 'refresh token flow' };
// }

// async function zohoRequest({ product, method, path, query, body, headers: extraHeaders }) {
//   const { token, config, source } = await getZohoAccessToken(product);
//   const baseUrl = product === 'crm' ? config.crmBaseUrl : config.mailBaseUrl;
//   const url = buildUrl(baseUrl, path, query);
//   const normalizedMethod = normalizeMethod(method);

//   const outboundHeaders = {
//     Authorization: `Zoho-oauthtoken ${token}`,
//     Accept: 'application/json',
//     ...(extraHeaders || {}),
//   };

//   let outboundBody;
//   if (body !== undefined && body !== null && normalizedMethod !== 'GET') {
//     outboundHeaders['Content-Type'] = 'application/json';
//     outboundBody = JSON.stringify(body);
//   }

//   const response = await fetch(url, {
//     method: normalizedMethod,
//     headers: outboundHeaders,
//     body: outboundBody,
//   });

//   const text = await response.text();
//   let payload = text;
//   try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }

//   return {
//     ok: response.ok,
//     status: response.status,
//     statusText: response.statusText,
//     authSource: source,
//     request: { product, method: normalizedMethod, url },
//     response: payload,
//   };
// }

// //mcp-server factory
// function getServer() {
//   const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

//   // zoho_oauth_helper
//   server.tool(
//     'zoho_oauth_helper',
//     'Build a Zoho OAuth authorization URL and show the token exchange request needed to obtain the first access token and refresh token.',
//     {
//       scopes:      z.array(z.string()).optional().describe('Optional list of Zoho scopes.'),
//       redirectUri: z.string().optional().describe('Optional redirect URI.'),
//       accessType:  z.string().optional().default('offline').describe('offline or online.'),
//       prompt:      z.string().optional().default('consent').describe('Usually consent.'),
//     },
//     async (args) => {
//       const config = resolveZohoConfig();
//       const redirectUri = args?.redirectUri || env('ZOHO_REDIRECT_URI');
//       const scopes = Array.isArray(args?.scopes) && args.scopes.length
//         ? args.scopes
//         : ['ZohoCRM.modules.contacts.READ', 'ZohoCRM.modules.contacts.ALL', 'ZohoMail.accounts.READ', 'ZohoMail.messages.ALL'];

//       if (!config.clientId) throw new Error('Missing ZOHO_CLIENT_ID in env.');
//       if (!redirectUri) throw new Error('Missing redirect URI. Provide redirectUri or set ZOHO_REDIRECT_URI in env.');

//       const authUrl = new URL(`${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/auth`);
//       authUrl.searchParams.set('response_type', 'code');
//       authUrl.searchParams.set('client_id', config.clientId);
//       authUrl.searchParams.set('redirect_uri', redirectUri);
//       authUrl.searchParams.set('scope', scopes.join(','));
//       authUrl.searchParams.set('access_type', args?.accessType || 'offline');
//       authUrl.searchParams.set('prompt', args?.prompt || 'consent');

//       const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;

//       return {
//         content: [{
//           type: 'text',
//           text: JSON.stringify({
//             oauthAuthorizationUrl: authUrl.toString(),
//             tokenUrl,
//             curlExample: `curl --request POST "${tokenUrl}" --header "Content-Type: application/x-www-form-urlencoded" --data "grant_type=authorization_code&client_id=${encodeURIComponent(config.clientId)}&client_secret=<SECRET>&redirect_uri=${encodeURIComponent(redirectUri)}&code=<CODE>"`,
//           }, null, 2),
//         }],
//       };
//     }
//   );

//   // zoho_crm_request
//   server.tool(
//     'zoho_crm_request',
//     'Call any Zoho CRM REST API endpoint. Auth is resolved from environment variables only.',
//     {
//       path:    z.string().describe('Zoho CRM API path, e.g. Contacts or Contacts/search.'),
//       method:  z.string().optional().default('GET').describe('HTTP method: GET, POST, PUT, PATCH, DELETE.'),
//       query:   z.record(z.string(), z.string()).optional().describe('Optional query string parameters.'),
//       body:    z.object({}).catchall(z.unknown()).optional().describe('Optional JSON request body as an object.'),
//       headers: z.record(z.string(), z.string()).optional().describe('Optional additional headers.'),
//     },
//     async (args) => {
//       return {
//         content: [{ type: 'text', text: JSON.stringify(await zohoRequest({ product: 'crm', ...args }), null, 2) }],
//       };
//     }
//   );

//   // zoho_mail_request
//   server.tool(
//     'zoho_mail_request',
//     'Call any Zoho Mail REST API endpoint. Auth is resolved from environment variables only.',
//     {
//       path:    z.string().describe('Zoho Mail API path, e.g. accounts or accounts/{accountId}/messages/view.'),
//       method:  z.string().optional().default('GET').describe('HTTP method: GET, POST, PUT, PATCH, DELETE.'),
//       query:   z.record(z.string(), z.string()).optional().describe('Optional query string parameters.'),
//       body:    z.object({}).catchall(z.unknown()).optional().describe('Optional JSON request body as an object.'),
//       headers: z.record(z.string(), z.string()).optional().describe('Optional additional headers.'),
//     },
//     async (args) => {
//       return {
//         content: [{ type: 'text', text: JSON.stringify(await zohoRequest({ product: 'mail', ...args }), null, 2) }],
//       };
//     }
//   );

//   // zoho_mail_send_message
//   server.tool(
//     'zoho_mail_send_message',
//     'Send an email through a Zoho Mail account. Use this instead of zoho_mail_request when sending mail so required fields are explicit.',
//     {
//       accountId: z.string().describe('Zoho Mail account ID.'),
//       fromAddress: z.string().describe('Sender email address. Must exist in the Zoho Mail account you are sending from.'),
//       toAddress: z.string().describe('Recipient email address. For multiple recipients, send a comma-separated string if Zoho accepts it for your account.'),
//       subject: z.string().describe('Email subject line.'),
//       content: z.string().describe('Email body content. HTML is allowed if supported by the target Zoho Mail API endpoint.'),
//       askReceipt: z.string().optional().default('no').describe('Delivery or read receipt flag expected by Zoho Mail. Usually "no" or "yes".'),
//       ccAddress: z.string().optional().describe('Optional CC email address string.'),
//       bccAddress: z.string().optional().describe('Optional BCC email address string.'),
//       mailFormat: z.string().optional().describe('Optional mail format value if required by Zoho Mail.'),
//     },
//     async (args) => {
//       const { accountId, ...body } = args;
//       return {
//         content: [{
//           type: 'text',
//           text: JSON.stringify(
//             await zohoRequest({
//               product: 'mail',
//               method: 'POST',
//               path: `accounts/${accountId}/messages`,
//               body,
//             }),
//             null,
//             2
//           ),
//         }],
//       };
//     }
//   );

//   // zoho_auth_info
//   server.tool(
//     'zoho_auth_info',
//     'Show which Zoho credential sources this MCP server will use for CRM and Mail without returning secret values.',
//     {},
//     async () => {
//       const config = resolveZohoConfig();
//       return {
//         content: [{
//           type: 'text',
//           text: JSON.stringify({
//             dataCenter: config.dataCenter,
//             crm:  { baseUrl: config.crmBaseUrl,  accessTokenSource: config.crmAccessToken  ? 'env access token' : 'refresh token flow' },
//             mail: { baseUrl: config.mailBaseUrl, accessTokenSource: config.mailAccessToken ? 'env access token' : 'refresh token flow' },
//             sharedRefreshCredentialsAvailable: Boolean(config.clientId && config.clientSecret && config.refreshToken),
//           }, null, 2),
//         }],
//       };
//     }
//   );

//   return server;
// }

// //routes
// app.post('/mcp', async (req, res) => {
//   try {
//     const server = getServer();
//     const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
//     await server.connect(transport);
//     await transport.handleRequest(req, res, req.body);
//     res.on('close', () => {
//       transport.close();
//       server.close();
//     });
//   } catch (error) {
//     console.error('Error handling MCP request:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         jsonrpc: '2.0',
//         error: { code: -32603, message: 'Internal server error' },
//         id: null,
//       });
//     }
//   }
// });

// app.get('/mcp', async (req, res) => {
//   const code = req.query.code;
//   if (code) {
//     const accountsServer = req.query['accounts-server'];
//     const redirectUri = env('ZOHO_REDIRECT_URI');
//     console.log(`Received OAuth callback with code: ${code}, accountsServer: ${accountsServer}`);
//     console.log(`Using redirect URI: ${redirectUri}`);
//     const clientId = env('ZOHO_CLIENT_ID');
//     console.log(`Using client ID: ${clientId ? 'present' : 'missing'}`);
//     const clientSecret = env('ZOHO_CLIENT_SECRET');
//     console.log(`Using client secret: ${clientSecret ? 'present' : 'missing'}`);
//     if (clientId && clientSecret) {
//       try {
//         const tokenResponse = await exchangeZohoAuthorizationCode({
//           accountsBaseUrl: accountsServer || 'https://accounts.zoho.com',
//           clientId, clientSecret, redirectUri, code,
//         });
//         return res.json({ ok: true, message: 'Authorization code exchanged. Persist the refresh_token in your env.', tokenResponse });
//       } catch (error) {
//         return res.status(500).json({ ok: false, message: error.message });
//       }
//     }
//   }
//   res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
// });

// app.delete('/mcp', (req, res) => {
//   res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
// });

// app.get('/health', (req, res) => {
//   res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, transport: 'http' });
// });


// const PORT = Number(env('PORT', '3000'));
// app.listen(PORT, () => {
//   console.log(`[${SERVER_NAME}] v${SERVER_VERSION} listening on port ${PORT}`);
// });

const express = require('express');
const { URL } = require('url');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const SERVER_NAME = 'zoho-mcp';
const SERVER_VERSION = '1.1.0';

const app = express();
app.use(express.json());

// ─── Helpers ─────────────────────────────────────────────────────────────────

function env(name, fallback = undefined) {
  return process.env[name] || fallback;
}

function getConfigValue(name, fallback = undefined) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function stripLeadingSlash(value = '') {
  return String(value).replace(/^\/+/, '');
}

function normalizeMethod(method = 'GET') {
  return String(method || 'GET').toUpperCase();
}

function buildUrl(baseUrl, requestPath, query = {}) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${stripLeadingSlash(requestPath)}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// ─── Token Cache (per user, keyed by refresh token) ──────────────────────────

// Map<refreshToken -> { crm: {token, expiresAt}, mail: {token, expiresAt} }>
const tokenCache = new Map();

function getCachedToken(product, refreshToken) {
  const userCache = tokenCache.get(refreshToken);
  if (!userCache) return null;
  const entry = userCache[product];
  if (entry && entry.token && Date.now() < entry.expiresAt) return entry.token;
  return null;
}

function setCachedToken(product, refreshToken, accessToken, ttlSeconds = 3000) {
  // Zoho tokens last 60 min (3600s), cache for 50 min (3000s) for safety
  if (!tokenCache.has(refreshToken)) {
    tokenCache.set(refreshToken, { crm: { token: null, expiresAt: 0 }, mail: { token: null, expiresAt: 0 } });
  }
  tokenCache.get(refreshToken)[product] = { token: accessToken, expiresAt: Date.now() + ttlSeconds * 1000 };
}

// ─── Zoho Auth ────────────────────────────────────────────────────────────────

function resolveZohoConfig() {
  const dataCenter = getConfigValue('ZOHO_DATA_CENTER', 'com');
  return {
    dataCenter,
    accountsBaseUrl: getConfigValue('ZOHO_ACCOUNTS_BASE_URL', `https://accounts.zoho.${dataCenter}`),
    crmBaseUrl:      getConfigValue('ZOHO_CRM_BASE_URL',      `https://www.zohoapis.${dataCenter}/crm/v6`),
    mailBaseUrl:     getConfigValue('ZOHO_MAIL_BASE_URL',     `https://mail.zoho.${dataCenter}/api`),
    clientId:        getConfigValue('ZOHO_CLIENT_ID'),
    clientSecret:    getConfigValue('ZOHO_CLIENT_SECRET'),
    refreshToken:    getConfigValue('ZOHO_REFRESH_TOKEN'),
    crmAccessToken:  env('ZOHO_CRM_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
    mailAccessToken: env('ZOHO_MAIL_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
  };
}

async function refreshZohoAccessToken(config, product) {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error(
      `Missing Zoho ${product} credentials. Set ZOHO_${product.toUpperCase()}_ACCESS_TOKEN or ZOHO_ACCESS_TOKEN, ` +
      `or set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in env.`
    );
  }
  const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  let response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Zoho token refresh timed out or failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function exchangeZohoAuthorizationCode({ accountsBaseUrl, clientId, clientSecret, redirectUri, code }) {
  if (!clientId || !clientSecret || !redirectUri || !code) {
    throw new Error('Missing clientId, clientSecret, redirectUri, or code.');
  }
  const tokenUrl = `${accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
    code,
  });
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Zoho authorization code exchange failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function getZohoAccessToken(product) {
  const config = resolveZohoConfig();

  // 1. Direct env token (highest priority, no caching needed)
  const directToken = product === 'crm' ? config.crmAccessToken : config.mailAccessToken;
  if (directToken) return { token: directToken, config, source: 'env access token' };

  // 2. Cached token — keyed by this user's refresh token
  const cached = getCachedToken(product, config.refreshToken);
  if (cached) return { token: cached, config, source: 'cached token' };

  // 3. Refresh token flow (only on cache miss)
  const refreshedToken = await refreshZohoAccessToken(config, product);
  setCachedToken(product, config.refreshToken, refreshedToken);
  return { token: refreshedToken, config, source: 'refresh token flow' };
}

async function zohoRequest({ product, method, path, query, body, headers: extraHeaders }) {
  const { token, config, source } = await getZohoAccessToken(product);
  const baseUrl = product === 'crm' ? config.crmBaseUrl : config.mailBaseUrl;
  const url = buildUrl(baseUrl, path, query);
  const normalizedMethod = normalizeMethod(method);

  const outboundHeaders = {
    Authorization: `Zoho-oauthtoken ${token}`,
    Accept: 'application/json',
    ...(extraHeaders || {}),
  };

  let outboundBody;
  if (body !== undefined && body !== null && normalizedMethod !== 'GET') {
    outboundHeaders['Content-Type'] = 'application/json';
    outboundBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method: normalizedMethod,
    headers: outboundHeaders,
    body: outboundBody,
  });

  const text = await response.text();
  let payload = text;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    authSource: source,
    request: { product, method: normalizedMethod, url },
    response: payload,
  };
}

// ─── MCP Server Factory ───────────────────────────────────────────────────────

function getServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // zoho_oauth_helper
  server.tool(
    'zoho_oauth_helper',
    'Build a Zoho OAuth authorization URL and show the token exchange request needed to obtain the first access token and refresh token.',
    {
      scopes:      z.array(z.string()).optional().describe('Optional list of Zoho scopes.'),
      redirectUri: z.string().optional().describe('Optional redirect URI.'),
      accessType:  z.string().optional().default('offline').describe('offline or online.'),
      prompt:      z.string().optional().default('consent').describe('Usually consent.'),
    },
    async (args) => {
      const config = resolveZohoConfig();
      const redirectUri = args?.redirectUri || env('ZOHO_REDIRECT_URI');
      const scopes = Array.isArray(args?.scopes) && args.scopes.length
        ? args.scopes
        : ['ZohoCRM.modules.contacts.READ', 'ZohoCRM.modules.contacts.ALL', 'ZohoMail.accounts.READ', 'ZohoMail.messages.ALL'];

      if (!config.clientId) throw new Error('Missing ZOHO_CLIENT_ID in env.');
      if (!redirectUri) throw new Error('Missing redirect URI. Provide redirectUri or set ZOHO_REDIRECT_URI in env.');

      const authUrl = new URL(`${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/auth`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scopes.join(','));
      authUrl.searchParams.set('access_type', args?.accessType || 'offline');
      authUrl.searchParams.set('prompt', args?.prompt || 'consent');

      const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            oauthAuthorizationUrl: authUrl.toString(),
            tokenUrl,
            curlExample: `curl --request POST "${tokenUrl}" --header "Content-Type: application/x-www-form-urlencoded" --data "grant_type=authorization_code&client_id=${encodeURIComponent(config.clientId)}&client_secret=<SECRET>&redirect_uri=${encodeURIComponent(redirectUri)}&code=<CODE>"`,
          }, null, 2),
        }],
      };
    }
  );

  // zoho_crm_request
  server.tool(
    'zoho_crm_request',
    'Call any Zoho CRM REST API endpoint. Auth is resolved from environment variables only.',
    {
      path:    z.string().describe('Zoho CRM API path, e.g. Contacts or Contacts/search.'),
      method:  z.string().optional().default('GET').describe('HTTP method: GET, POST, PUT, PATCH, DELETE.'),
      query:   z.record(z.string(), z.string()).optional().describe('Optional query string parameters.'),
      body:    z.object({}).catchall(z.unknown()).optional().describe('Optional JSON request body as an object.'),
      headers: z.record(z.string(), z.string()).optional().describe('Optional additional headers.'),
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await zohoRequest({ product: 'crm', ...args }), null, 2) }],
    })
  );

  // zoho_mail_request
  server.tool(
    'zoho_mail_request',
    'Call any Zoho Mail REST API endpoint. Auth is resolved from environment variables only.',
    {
      path:    z.string().describe('Zoho Mail API path, e.g. accounts or accounts/{accountId}/messages/view.'),
      method:  z.string().optional().default('GET').describe('HTTP method: GET, POST, PUT, PATCH, DELETE.'),
      query:   z.record(z.string(), z.string()).optional().describe('Optional query string parameters.'),
      body:    z.object({}).catchall(z.unknown()).optional().describe('Optional JSON request body as an object.'),
      headers: z.record(z.string(), z.string()).optional().describe('Optional additional headers.'),
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await zohoRequest({ product: 'mail', ...args }), null, 2) }],
    })
  );

  // zoho_mail_send_message
  server.tool(
    'zoho_mail_send_message',
    'Send an email through a Zoho Mail account. Use this instead of zoho_mail_request when sending mail so required fields are explicit.',
    {
      accountId:   z.string().describe('Zoho Mail account ID.'),
      fromAddress: z.string().describe('Sender email address. Must exist in the Zoho Mail account.'),
      toAddress:   z.string().describe('Recipient email address. Comma-separated for multiple.'),
      subject:     z.string().describe('Email subject line.'),
      content:     z.string().describe('Email body content. HTML is supported.'),
      askReceipt:  z.string().optional().default('no').describe('Receipt flag: "no" or "yes".'),
      ccAddress:   z.string().optional().describe('Optional CC email address.'),
      bccAddress:  z.string().optional().describe('Optional BCC email address.'),
      mailFormat:  z.string().optional().describe('Optional mail format, e.g. "html".'),
    },
    async (args) => {
      const { accountId, ...body } = args;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            await zohoRequest({ product: 'mail', method: 'POST', path: `accounts/${accountId}/messages`, body }),
            null, 2
          ),
        }],
      };
    }
  );

  // zoho_auth_info
  server.tool(
    'zoho_auth_info',
    'Show which Zoho credential sources this MCP server will use for CRM and Mail without returning secret values.',
    {},
    async () => {
      const config = resolveZohoConfig();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            dataCenter: config.dataCenter,
            crm:  { baseUrl: config.crmBaseUrl,  accessTokenSource: config.crmAccessToken  ? 'env access token' : 'refresh token flow' },
            mail: { baseUrl: config.mailBaseUrl, accessTokenSource: config.mailAccessToken ? 'env access token' : 'refresh token flow' },
            sharedRefreshCredentialsAvailable: Boolean(config.clientId && config.clientSecret && config.refreshToken),
            tokenCacheUsers: tokenCache.size,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/mcp', async (req, res) => {
  try {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const code = req.query.code;
  if (code) {
    const accountsServer = req.query['accounts-server'];
    const redirectUri = env('ZOHO_REDIRECT_URI');
    const clientId = env('ZOHO_CLIENT_ID');
    const clientSecret = env('ZOHO_CLIENT_SECRET');
    console.log(`OAuth callback: code=${!!code}, accountsServer=${accountsServer}, redirectUri=${redirectUri}, clientId=${clientId ? 'present' : 'missing'}`);
    if (clientId && clientSecret) {
      try {
        const tokenResponse = await exchangeZohoAuthorizationCode({
          accountsBaseUrl: accountsServer || 'https://accounts.zoho.com',
          clientId, clientSecret, redirectUri, code,
        });
        return res.json({ ok: true, message: 'Authorization code exchanged. Persist the refresh_token in your env.', tokenResponse });
      } catch (error) {
        return res.status(500).json({ ok: false, message: error.message });
      }
    }
  }
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

app.delete('/mcp', (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, transport: 'http' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(env('PORT', '3000'));
app.listen(PORT, async () => {
  console.log(`[${SERVER_NAME}] v${SERVER_VERSION} listening on port ${PORT}`);
  // Pre-warm token cache on startup so first request doesn't hit Zoho auth
  try {
    await getZohoAccessToken('crm');
    console.log(`[${SERVER_NAME}] CRM token pre-warmed`);
  } catch (e) {
    console.warn(`[${SERVER_NAME}] CRM token pre-warm failed: ${e.message}`);
  }
  try {
    await getZohoAccessToken('mail');
    console.log(`[${SERVER_NAME}] Mail token pre-warmed`);
  } catch (e) {
    console.warn(`[${SERVER_NAME}] Mail token pre-warm failed: ${e.message}`);
  }
});   