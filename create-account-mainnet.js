// @ts-nocheck
import dpixa from "@pixagram/dpixa/lib/index-browser";
// =============================================================================
// HELPER FUNCTIONS (Pure, no external dependencies)
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function validateAccountName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Account name is required' };
  }

  const n = name.toLowerCase();

  if (n.length < 3) return { valid: false, error: 'Account name must be at least 3 characters' };
  if (n.length > 16) return { valid: false, error: 'Account name must be at most 16 characters' };
  if (!/^[a-z]/.test(n)) return { valid: false, error: 'Account name must start with a letter' };
  if (!/^[a-z0-9.-]+$/.test(n)) return { valid: false, error: 'Account name can only contain lowercase letters, numbers, hyphens, and periods' };
  if (/--/.test(n) || /\.\./.test(n)) return { valid: false, error: 'Account name cannot contain consecutive hyphens or periods' };
  if (/[-.]$/.test(n)) return { valid: false, error: 'Account name cannot end with a hyphen or period' };

  const segments = n.split('.');
  for (const segment of segments) {
    if (segment.length < 3) return { valid: false, error: 'Each segment must be at least 3 characters' };
  }

  return { valid: true, name: n };
}

// UPDATE: Now accepts the prefix as an argument
function validatePublicKey(key, keyName, prefix) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: `${keyName} key is required` };
  }
  if (!key.startsWith(prefix)) {
    return { valid: false, error: `${keyName} key must start with ${prefix}` };
  }
  if (key.length < 50 || key.length > 60) {
    return { valid: false, error: `${keyName} key has invalid length` };
  }
  return { valid: true };
}

// UPDATE: Now accepts 'env' to read config inside the function
async function createAccount(env, accountName, keys) {
  const client = new dpixa.Client([env.NODE_URL]);

  // Check if account exists
  const existing = await client.database.getAccounts([accountName]);
  if (existing && existing.length > 0) {
    throw new Error(`Account @${accountName} already exists`);
  }

  // Operation 1: Create the account
  const createOp = ['account_create', {
    fee: env.CREATION_FEE,
    creator: env.CREATOR_ACCOUNT,
    new_account_name: accountName,
    owner: { weight_threshold: 1, account_auths: [], key_auths: [[keys.owner, 1]] },
    active: { weight_threshold: 1, account_auths: [], key_auths: [[keys.active, 1]] },
    posting: { weight_threshold: 1, account_auths: [], key_auths: [[keys.posting, 1]] },
    memo_key: keys.memo,
    json_metadata: JSON.stringify({ created_by: 'pixa-account-creator', created_at: new Date().toISOString() }),
  }];

  // Operation 2: Delegate VESTS
  const delegateOp = ['delegate_vesting_shares', {
    delegator: env.CREATOR_ACCOUNT,
    delegatee: accountName,
    vesting_shares: env.DELEGATION_AMOUNT
  }];

  const ops = [createOp, delegateOp];

  // Operation 3 (optional): Send liquid PIXA tokens to the new account
  if (env.GIVEN_PIXA) {
    ops.push(['transfer', {
      from: env.CREATOR_ACCOUNT,
      to: accountName,
      amount: env.GIVEN_PIXA,
      memo: '',
    }]);
  }

  const privateKey = dpixa.PrivateKey.fromString(env.PIXA_ACTIVE_KEY);

  return await client.broadcast.sendOperations(ops, privateKey);
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'pixa-account-creator', timestamp: new Date().toISOString() });
    }

    // Create account
    if (url.pathname === '/create-account' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
      }

      const { account_name, owner_key, active_key, posting_key, memo_key } = body;

      // Validate account name
      const nameCheck = validateAccountName(account_name);
      if (!nameCheck.valid) {
        return jsonResponse({ success: false, error: nameCheck.error, field: 'account_name' }, 400);
      }

      // Validate keys
      // UPDATE: Pass env.PUBLIC_KEY_PREFIX here
      for (const [key, name] of [[owner_key, 'owner'], [active_key, 'active'], [posting_key, 'posting'], [memo_key, 'memo']]) {
        const check = validatePublicKey(key, name, env.PUBLIC_KEY_PREFIX);
        if (!check.valid) {
          return jsonResponse({ success: false, error: check.error, field: `${name}_key` }, 400);
        }
      }

      // Create account
      try {
        if (!env.PIXA_ACTIVE_KEY) {
          return jsonResponse({ success: false, error: 'Server configuration error: Active key not set' }, 503);
        }

        // UPDATE: Pass the whole env object to the helper
        const result = await createAccount(env, nameCheck.name, {
          owner: owner_key,
          active: active_key,
          posting: posting_key,
          memo: memo_key,
        });

        return jsonResponse({
          success: true,
          account_name: nameCheck.name,
          transaction_id: result.id,
          block_num: result.block_num,
          delegation: env.DELEGATION_AMOUNT,
          given_pixa: env.GIVEN_PIXA || '0',
          message: `Account @${nameCheck.name} created and funded successfully`,
        }, 201);

      } catch (error) {
        const msg = error.message || 'Unknown error';
        const status = msg.includes('already exists') ? 409 : 500;
        return jsonResponse({ success: false, error: msg }, status);
      }
    }

    // 404
    return jsonResponse({ success: false, error: 'Not found', endpoints: ['POST /create-account', 'GET /health'] }, 404);
  },
};

/*
+-----------+-------------------+-----------------------------+
| Type      | Name              | Value                       |
+-----------+-------------------+-----------------------------+
| Plaintext | CREATION_FEE      | 0.000 PIXA                  |
| Plaintext | CREATOR_ACCOUNT   | initminer                   |
| Plaintext | DELEGATION_AMOUNT | 5000.000000 VESTS           |
| Plaintext | GIVEN_PIXA        | 0.000 PIXA                  |
| Plaintext | NODE_URL          | https://api.pixagram.com    |
| Secret    | PIXA_ACTIVE_KEY   | Value encrypted             |
| Plaintext | PUBLIC_KEY_PREFIX | PIX                         |
+-----------+-------------------+-----------------------------+
*/
