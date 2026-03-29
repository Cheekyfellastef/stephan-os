import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_KEYS } from '../../shared/ai/providerDefaults.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const SECRET_STORE_FILE = path.join(DATA_DIR, 'provider-secrets.json');

const SECRET_PROVIDERS = new Set(PROVIDER_KEYS.filter((provider) => provider !== 'mock' && provider !== 'ollama'));

function normalizeProviderKey(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  return SECRET_PROVIDERS.has(normalized) ? normalized : '';
}

function normalizeSecretValue(value) {
  return String(value || '').trim();
}

function createDefaultStore() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    providers: {},
  };
}

function redactSecret(value = '') {
  const normalized = normalizeSecretValue(value);
  if (!normalized) return '';
  if (normalized.length <= 8) return '••••••••';
  return `••••••••${normalized.slice(-4)}`;
}

export class ProviderSecretStore {
  constructor(storageFile = SECRET_STORE_FILE) {
    this.storageFile = storageFile;
    this.loaded = false;
    this.store = createDefaultStore();
  }

  ensureStorage() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    if (!fs.existsSync(this.storageFile)) {
      fs.writeFileSync(this.storageFile, JSON.stringify(createDefaultStore(), null, 2), 'utf8');
    }
  }

  load() {
    if (this.loaded) return this.store;
    this.ensureStorage();
    const raw = fs.readFileSync(this.storageFile, 'utf8');
    try {
      const parsed = JSON.parse(raw || '{}');
      const providers = parsed?.providers && typeof parsed.providers === 'object' ? parsed.providers : {};
      const normalized = Object.fromEntries(
        Object.entries(providers)
          .map(([provider, entry]) => [normalizeProviderKey(provider), entry])
          .filter(([provider]) => Boolean(provider))
          .map(([provider, entry]) => [provider, {
            apiKey: normalizeSecretValue(entry?.apiKey || ''),
            updatedAt: String(entry?.updatedAt || ''),
          }]),
      );
      this.store = {
        schemaVersion: 1,
        updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
        providers: normalized,
      };
      this.loaded = true;
      return this.store;
    } catch {
      this.store = createDefaultStore();
      this.persist();
      this.loaded = true;
      return this.store;
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storageFile, JSON.stringify(this.store, null, 2), 'utf8');
  }

  setSecret(provider, apiKey) {
    this.load();
    const providerKey = normalizeProviderKey(provider);
    const normalizedKey = normalizeSecretValue(apiKey);
    if (!providerKey) {
      throw new Error('Unsupported provider secret target.');
    }
    if (!normalizedKey) {
      throw new Error('API key is required.');
    }

    this.store.providers[providerKey] = {
      apiKey: normalizedKey,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.getMaskedProviderStatus(providerKey);
  }

  clearSecret(provider) {
    this.load();
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey) return false;
    if (!this.store.providers[providerKey]) return false;
    delete this.store.providers[providerKey];
    this.persist();
    return true;
  }

  getSecret(provider) {
    this.load();
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey) return '';
    return normalizeSecretValue(this.store.providers?.[providerKey]?.apiKey || '');
  }

  buildProviderConfigOverlay() {
    return Object.fromEntries(
      Array.from(SECRET_PROVIDERS).map((provider) => [provider, { apiKey: this.getSecret(provider) }]),
    );
  }

  getMaskedProviderStatus(provider) {
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey) return null;
    const secret = this.getSecret(providerKey);
    const updatedAt = this.store.providers?.[providerKey]?.updatedAt || null;
    return {
      provider: providerKey,
      configured: Boolean(secret),
      masked: redactSecret(secret),
      updatedAt,
      authority: 'backend-local-secret-store',
    };
  }

  getMaskedStatusSnapshot() {
    return Object.fromEntries(
      Array.from(SECRET_PROVIDERS).map((provider) => [provider, this.getMaskedProviderStatus(provider)]),
    );
  }
}

export const providerSecretStore = new ProviderSecretStore();
