const http = require('http');
const { URL } = require('url');
const dotenv = require('dotenv');
const { Server } = require('@modelcontextprotocol/sdk/server');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const SERVER_NAME = 'zoho-mcp';
const SERVER_VERSION = '1.1.0';

dotenv.config();

function env(name, fallback = undefined) {
  return process.env[name] || fallback;
}

function getConfigValue(envName, fallback = undefined) {
  if (process.env[envName] !== undefined && process.env[envName] !== '') {
    return process.env[envName];
  }
  return fallback;
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
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function parseJson(body) {
  if (!body) return null;
  return JSON.parse(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? parseJson(raw) : null;
}

function resolveZohoConfig(_headers = {}) {
  const dataCenter = getConfigValue('ZOHO_DATA_CENTER', 'com');

  return {
    dataCenter,
    accountsBaseUrl: getConfigValue('ZOHO_ACCOUNTS_BASE_URL', `https://accounts.zoho.${dataCenter}`),
    crmBaseUrl: getConfigValue('ZOHO_CRM_BASE_URL', `https://www.zohoapis.${dataCenter}/crm/v6`),
    mailBaseUrl: getConfigValue('ZOHO_MAIL_BASE_URL', `https://mail.zoho.${dataCenter}/api`),
    clientId: getConfigValue('ZOHO_CLIENT_ID'),
    clientSecret: getConfigValue('ZOHO_CLIENT_SECRET'),
    refreshToken: getConfigValue('ZOHO_REFRESH_TOKEN'),
    crmAccessToken: env('ZOHO_CRM_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
    mailAccessToken: env('ZOHO_MAIL_ACCESS_TOKEN') || env('ZOHO_ACCESS_TOKEN'),
  };
}

async function refreshZohoAccessToken(config, product) {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error(
      `Missing Zoho ${product} credentials. Set ZOHO_${product.toUpperCase()}_ACCESS_TOKEN or ZOHO_ACCESS_TOKEN, or set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in env.`
    );
  }

  const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

async function exchangeZohoAuthorizationCode({ accountsBaseUrl, clientId, clientSecret, redirectUri, code }) {
  if (!clientId || !clientSecret || !redirectUri || !code) {
    throw new Error('Missing clientId, clientSecret, redirectUri, or code for Zoho authorization code exchange.');
  }

  const tokenUrl = `${accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Zoho authorization code exchange failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function getZohoAccessToken(product, headers = {}) {
  const config = resolveZohoConfig(headers);
  const directToken = product === 'crm' ? config.crmAccessToken : config.mailAccessToken;
  if (directToken) {
    return { token: directToken, config, source: 'header/env access token' };
  }

  const refreshedToken = await refreshZohoAccessToken(config, product);
  return { token: refreshedToken, config, source: 'refresh token flow' };
}

async function zohoRequest({ product, method, path, query, body, headers: extraHeaders }, requestHeaders) {
  const { token, config, source } = await getZohoAccessToken(product, requestHeaders);
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
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    authSource: source,
    request: {
      product,
      method: normalizedMethod,
      url,
    },
    response: payload,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'zoho_oauth_helper',
    description:
      'Build a Zoho OAuth authorization URL and show the token exchange request needed to obtain the first access token and refresh token for this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        scopes: {
          type: 'array',
          description: 'Optional list of Zoho scopes. If omitted, CRM and Mail defaults are used.',
          items: { type: 'string' },
        },
        redirectUri: {
          type: 'string',
          description: 'Optional redirect URI. Falls back to ZOHO_REDIRECT_URI if set.',
        },
        accessType: {
          type: 'string',
          description: 'offline to request refresh token, or online for access-token-only flow.',
          default: 'offline',
        },
        prompt: {
          type: 'string',
          description: 'Usually consent to ensure refresh token issuance.',
          default: 'consent',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'zoho_crm_request',
    description:
      'Call any Zoho CRM REST API endpoint. This generic tool covers the full Zoho CRM API surface. Auth is resolved from environment variables only.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'HTTP method such as GET, POST, PUT, PATCH, or DELETE.',
          default: 'GET',
        },
        path: {
          type: 'string',
          description: 'Zoho CRM API path relative to the CRM base URL, for example Contacts or Contacts/search.',
        },
        query: {
          type: 'object',
          description: 'Optional query string parameters.',
          additionalProperties: true,
        },
        body: {
          description: 'Optional JSON request body.',
        },
        headers: {
          type: 'object',
          description: 'Optional additional upstream request headers sent to Zoho CRM.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'zoho_mail_request',
    description:
      'Call any Zoho Mail REST API endpoint. This generic tool covers the full Zoho Mail API surface. Auth is resolved from environment variables only.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'HTTP method such as GET, POST, PUT, PATCH, or DELETE.',
          default: 'GET',
        },
        path: {
          type: 'string',
          description: 'Zoho Mail API path relative to the Mail base URL, for example accounts or accounts/{accountId}/messages/view.',
        },
        query: {
          type: 'object',
          description: 'Optional query string parameters.',
          additionalProperties: true,
        },
        body: {
          description: 'Optional JSON request body.',
        },
        headers: {
          type: 'object',
          description: 'Optional additional upstream request headers sent to Zoho Mail.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'zoho_auth_info',
    description:
      'Show which Zoho environment-based credential sources this MCP server will use for CRM and Mail without returning any secret values.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = TOOL_DEFINITIONS.map(tool => tool.name);

async function handleToolCall(name, args, requestHeaders) {
  if (name === 'zoho_oauth_helper') {
    const config = resolveZohoConfig(requestHeaders);
    const redirectUri = args?.redirectUri || env('ZOHO_REDIRECT_URI');
    const scopes = Array.isArray(args?.scopes) && args.scopes.length
      ? args.scopes
      : [
          'ZohoCRM.modules.contacts.READ',
          'ZohoCRM.modules.contacts.ALL',
          'ZohoMail.accounts.READ',
          'ZohoMail.messages.ALL',
        ];
    const accessType = args?.accessType || 'offline';
    const prompt = args?.prompt || 'consent';

    if (!config.clientId) {
      throw new Error('Missing ZOHO_CLIENT_ID in env, required to build the OAuth authorization URL.');
    }

    if (!redirectUri) {
      throw new Error('Missing redirect URI. Provide redirectUri in tool arguments or set ZOHO_REDIRECT_URI in env.');
    }

    const authUrl = new URL(`${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/auth`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes.join(','));
    authUrl.searchParams.set('access_type', accessType);
    authUrl.searchParams.set('prompt', prompt);

    const tokenUrl = `${config.accountsBaseUrl.replace(/\/+$/, '')}/oauth/v2/token`;

    return toolResult({
      dataCenter: config.dataCenter,
      accountsBaseUrl: config.accountsBaseUrl,
      oauthAuthorizationUrl: authUrl.toString(),
      whatToDo: [
        'Open oauthAuthorizationUrl in a browser and approve access.',
        'Zoho redirects to your redirect_uri with a code query parameter.',
        'Exchange that code once at the tokenUrl shown below.',
        'Save the returned refresh_token into ZOHO_REFRESH_TOKEN in your .env.',
      ],
      tokenExchangeRequest: {
        method: 'POST',
        url: tokenUrl,
        contentType: 'application/x-www-form-urlencoded',
        bodyTemplate: {
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret ? '<from env: present>' : '<set ZOHO_CLIENT_SECRET in env>',
          redirect_uri: redirectUri,
          code: '<paste_code_from_redirect_here>',
        },
      },
      curlExample: `curl --request POST "${tokenUrl}" --header "Content-Type: application/x-www-form-urlencoded" --data "grant_type=authorization_code&client_id=${encodeURIComponent(config.clientId)}&client_secret=<YOUR_CLIENT_SECRET>&redirect_uri=${encodeURIComponent(redirectUri)}&code=<CODE_FROM_REDIRECT>"`,
      envToPersist: [
        'ZOHO_CLIENT_ID',
        'ZOHO_CLIENT_SECRET',
        'ZOHO_REFRESH_TOKEN',
        'ZOHO_DATA_CENTER',
        'ZOHO_REDIRECT_URI',
      ],
      notes: [
        'Use access_type=offline and prompt=consent if you want a refresh token.',
        'Without a refresh token, you must keep replacing ZOHO_ACCESS_TOKEN or ZOHO_CRM_ACCESS_TOKEN manually after expiry.',
      ],
    });
  }

  if (name === 'zoho_crm_request') {
    return toolResult(await zohoRequest({ product: 'crm', ...(args || {}) }, requestHeaders));
  }

  if (name === 'zoho_mail_request') {
    return toolResult(await zohoRequest({ product: 'mail', ...(args || {}) }, requestHeaders));
  }

  if (name === 'zoho_auth_info') {
    const config = resolveZohoConfig(requestHeaders);
    return toolResult({
      dataCenter: config.dataCenter,
      crm: {
        baseUrl: config.crmBaseUrl,
        accessTokenSource: config.crmAccessToken ? 'env access token' : 'refresh token flow',
      },
      mail: {
        baseUrl: config.mailBaseUrl,
        accessTokenSource: config.mailAccessToken ? 'env access token' : 'refresh token flow',
      },
      sharedRefreshCredentialsAvailable: Boolean(
        config.clientId && config.clientSecret && config.refreshToken
      ),
      supportedEnvVars: [
        'ZOHO_DATA_CENTER',
        'ZOHO_ACCOUNTS_BASE_URL',
        'ZOHO_CRM_BASE_URL',
        'ZOHO_MAIL_BASE_URL',
        'ZOHO_CLIENT_ID',
        'ZOHO_CLIENT_SECRET',
        'ZOHO_REFRESH_TOKEN',
        'ZOHO_ACCESS_TOKEN',
        'ZOHO_CRM_ACCESS_TOKEN',
        'ZOHO_MAIL_ACCESS_TOKEN',
      ],
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function createMcpServer() {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const headers = extra.requestInfo?.headers || {};
    return handleToolCall(request.params.name, request.params.arguments || {}, headers);
  });

  return server;
}

async function handleCallback(requestUrl, port, res) {
  const code = requestUrl.searchParams.get('code');
  const location = requestUrl.searchParams.get('location');
  const accountsServer = requestUrl.searchParams.get('accounts-server');
  const redirectUri = env('ZOHO_REDIRECT_URI', `http://localhost:${port}/callback`);
  const clientId = env('ZOHO_CLIENT_ID');
  const clientSecret = env('ZOHO_CLIENT_SECRET');

  if (code && clientId && clientSecret) {
    try {
      const tokenResponse = await exchangeZohoAuthorizationCode({
        accountsBaseUrl: accountsServer || 'https://accounts.zoho.com',
        clientId,
        clientSecret,
        redirectUri,
        code,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        message: 'Authorization code exchanged successfully. Persist the refresh_token in your .env.',
        redirectUri,
        tokenResponse,
        envToPersist: {
          ZOHO_CLIENT_ID: clientId,
          ZOHO_CLIENT_SECRET: '<already set>',
          ZOHO_REFRESH_TOKEN: tokenResponse.refresh_token || '<not returned>',
        },
      }));
      return;
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        message: error.message,
        code,
        redirectUri,
      }));
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    message: 'Authorization code received. Exchange this code at the Zoho token endpoint to get refresh_token and access_token.',
    code,
    location,
    accountsServer,
    nextStep: {
      method: 'POST',
      url: `${accountsServer || 'https://accounts.zoho.com'}/oauth/v2/token`,
      contentType: 'application/x-www-form-urlencoded',
      body: {
        grant_type: 'authorization_code',
        client_id: clientId || '<set ZOHO_CLIENT_ID>',
        client_secret: clientSecret ? '<from env>' : '<set ZOHO_CLIENT_SECRET>',
        redirect_uri: redirectUri,
        code: code || '<missing code>',
      },
    },
  }));
}

async function handleMcpHttpRequest(req, res, parsedBody) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    res.on('close', async () => {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error.message,
        },
        id: null,
      }));
    }
  }
}

function startHttpServer(port) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://localhost:${port}`);

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'http',
        port,
        tools: TOOL_NAMES,
      }));
      return;
    }

    if (requestUrl.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'http',
        port,
        tools: TOOL_NAMES,
      }));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/mcp') {
      const code = requestUrl.searchParams.get('code');

     if (code) {
       await handleCallback(requestUrl, port, res);
       return;
    }

  // If no code → normal info response
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'MCP endpoint is live. Use POST for tool calls.',
  }));
  return;
}

    if (req.method !== 'POST' || requestUrl.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const parsedBody = await readJsonBody(req);
      await handleMcpHttpRequest(req, res, parsedBody);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error.message,
          },
          id: null,
        }));
      }
    }
  });

  server.listen(port, () => {
    console.error(`[${SERVER_NAME}] version=${SERVER_VERSION} transport=http port=${port}`);
    console.error(`[${SERVER_NAME}] tools=${TOOL_NAMES.join(', ')}`);
    console.error(`[${SERVER_NAME}] health=http://localhost:${port}/health`);
    console.error(`[${SERVER_NAME}] version_url=http://localhost:${port}/version`);
    console.error(`[${SERVER_NAME}] mcp=http://localhost:${port}/mcp`);
  });
}

async function startStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  const transport = env('MCP_TRANSPORT', 'stdio').toLowerCase();
  if (transport === 'http') {
    const port = Number(env('PORT', '3001'));
    startHttpServer(port);
    return;
  }

  console.error(`[${SERVER_NAME}] version=${SERVER_VERSION} transport=stdio`);
  console.error(`[${SERVER_NAME}] tools=${TOOL_NAMES.join(', ')}`);
  await startStdioServer();
}

main().catch(error => {
  console.error(`[${SERVER_NAME}] fatal=${error.message}`);
  process.exit(1);
});
