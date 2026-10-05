import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const clientEnvPath = path.join(rootDir, 'client', '.env');
const serverEnvPath = path.join(rootDir, 'server', '.env');

async function readEnvFile(filePath, label) {
  try {
    return dotenv.parse(await readFile(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing. Create it at ${filePath} (the filename must be exactly .env).`);
    }
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function requireVariables(env, variables, filePath) {
  for (const variable of variables) {
    if (!env[variable]?.trim()) {
      throw new Error(`Missing ${variable} in ${filePath}. Add it to that exact .env file.`);
    }
  }
}

async function checkKey(url, key, label) {
  let response;
  try {
    response = await fetch(`${url}/rest/v1/modules?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new Error(`${label} could not reach Supabase. Check the project URL and internet connection (${error.message}).`);
  }

  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label} was rejected (HTTP ${response.status}). Check that you copied the correct key for this file.`);
  }
  if (response.status === 404) {
    throw new Error('Supabase is reachable, but the modules table was not found. Run supabase/schema.sql in the project SQL Editor first.');
  }
  throw new Error(`${label} could not verify the project (HTTP ${response.status}). Check the Supabase URL and project status.`);
}

try {
  const [clientEnv, serverEnv] = await Promise.all([
    readEnvFile(clientEnvPath, 'client/.env'),
    readEnvFile(serverEnvPath, 'server/.env'),
  ]);

  requireVariables(clientEnv, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], 'client/.env');
  requireVariables(serverEnv, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], 'server/.env');

  if (clientEnv.SUPABASE_SERVICE_ROLE_KEY || clientEnv.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('A service-role key is present in client/.env. Remove it immediately; secrets must stay in server/.env.');
  }

  const clientUrl = new URL(clientEnv.VITE_SUPABASE_URL);
  const serverUrl = new URL(serverEnv.SUPABASE_URL);
  if (clientUrl.protocol !== 'https:' || serverUrl.protocol !== 'https:') {
    throw new Error('Both project URLs must start with https://. Copy the Project URL from Supabase settings.');
  }
  if (clientUrl.origin !== serverUrl.origin) {
    throw new Error('The project URLs in client/.env and server/.env do not match. Use the same Supabase project URL in both.');
  }

  await checkKey(clientUrl.origin, clientEnv.VITE_SUPABASE_ANON_KEY, 'The client anon key');
  await checkKey(serverUrl.origin, serverEnv.SUPABASE_SERVICE_ROLE_KEY, 'The server service-role key');
  console.log('Connected to Supabase');
} catch (error) {
  console.error(`Supabase connection check failed: ${error.message}`);
  process.exitCode = 1;
}