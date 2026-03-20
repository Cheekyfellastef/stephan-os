import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../utils/logger.js';
import { createError, ERROR_CODES } from './errors.js';
import { activityLogService } from './activityLogService.js';

const logger = createLogger('memory-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
export const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
export const MEMORY_CATEGORIES = ['project', 'preference', 'troubleshooting', 'architecture', 'workflow'];
const DEFAULT_IMPORTANCE = 3;
const MEMORY_PROMPT_LIMIT = 4;
const DEFAULT_MEMORY_SOURCE = 'manual';
const SECRET_PATTERNS = [
  /sk-[a-z0-9]{12,}/i,
  /AIza[0-9A-Za-z\-_]{20,}/,
  /gsk_[0-9A-Za-z]{12,}/i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s]+/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
];

const SEEDED_ITEMS = [
  {
    id: 'mem_launcher_dev_5173',
    category: 'project',
    title: 'Launcher uses localhost:5173 dev path',
    content: 'Stephanos launcher currently targets the Vite development UI at localhost:5173 during local development.',
    tags: ['launcher', 'vite', 'localhost:5173', 'dev'],
    importance: 5,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mem_backend_8787',
    category: 'architecture',
    title: 'Backend runs on port 8787',
    content: 'Stephanos local backend API runs on port 8787.',
    tags: ['backend', 'port', '8787', 'api'],
    importance: 5,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mem_ollama_11434',
    category: 'architecture',
    title: 'Ollama runs on localhost:11434',
    content: 'Local Ollama is expected at localhost:11434 for Stephanos local-first AI routing.',
    tags: ['ollama', 'localhost:11434', 'llm', 'local'],
    importance: 5,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mem_gpt_oss_timeout',
    category: 'troubleshooting',
    title: 'gpt-oss:20b may need a 60000ms timeout',
    content: 'When routing requests to gpt-oss:20b through Ollama, Stephanos may need a longer timeout such as 60000ms.',
    tags: ['ollama', 'gpt-oss:20b', 'timeout', '60000ms'],
    importance: 4,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mem_desktop_ignition_switch',
    category: 'preference',
    title: 'User wants a desktop ignition switch',
    content: 'User wants a desktop ignition switch experience that opens Stephanos automatically.',
    tags: ['desktop', 'ignition-switch', 'launcher', 'preference'],
    importance: 4,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mem_local_first_private',
    category: 'workflow',
    title: 'User prefers local-first private operation',
    content: 'Stephanos should stay local-first and privacy-oriented whenever possible, avoiding unnecessary cloud dependencies.',
    tags: ['local-first', 'privacy', 'workflow', 'preference'],
    importance: 5,
    source: 'seed',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  },
];

function toIsoDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeTags(tags = []) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))];
  }

  return [...new Set(String(tags || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function containsSecretLikeValue(...values) {
  const combined = values.filter(Boolean).join('\n');
  return SECRET_PATTERNS.some((pattern) => pattern.test(combined));
}

function sanitizeImportance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_IMPORTANCE;
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function memoryText(item = {}) {
  return [item.title, item.content].filter(Boolean).join(': ');
}

function normalizeMemoryItem(input = {}, { existing = null } = {}) {
  const now = new Date().toISOString();
  const category = MEMORY_CATEGORIES.includes(String(input.category || existing?.category || '').trim().toLowerCase())
    ? String(input.category || existing?.category).trim().toLowerCase()
    : 'project';
  const title = normalizeText(input.title ?? existing?.title ?? input.text ?? '');
  const content = normalizeText(input.content ?? existing?.content ?? input.text ?? '');
  const source = normalizeText(input.source ?? existing?.source ?? DEFAULT_MEMORY_SOURCE) || DEFAULT_MEMORY_SOURCE;
  const tags = normalizeTags(input.tags ?? existing?.tags ?? []);
  const createdAt = toIsoDate(input.createdAt ?? existing?.createdAt, existing?.createdAt || now);
  const updatedAt = toIsoDate(input.updatedAt, now);
  const id = normalizeText(input.id ?? existing?.id ?? `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const importance = sanitizeImportance(input.importance ?? existing?.importance ?? DEFAULT_IMPORTANCE);

  if (!title) {
    throw createError(ERROR_CODES.CMD_INVALID, 'Memory title is required.', { status: 400 });
  }

  if (!content) {
    throw createError(ERROR_CODES.CMD_INVALID, 'Memory content is required.', { status: 400 });
  }

  if (!MEMORY_CATEGORIES.includes(category)) {
    throw createError(ERROR_CODES.CMD_INVALID, `Memory category must be one of: ${MEMORY_CATEGORIES.join(', ')}.`, { status: 400 });
  }

  if (containsSecretLikeValue(title, content, source)) {
    throw createError(ERROR_CODES.CMD_INVALID, 'Stephanos memory rejects secret-like values. Do not store API keys, tokens, passwords, or private keys.', { status: 400 });
  }

  return {
    id,
    category,
    title,
    content,
    tags,
    createdAt,
    updatedAt,
    importance,
    source,
    text: memoryText({ title, content }),
  };
}

function keywordTokens(query = '') {
  return [...new Set(String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9:.\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

export class MemoryService {
  constructor(storageFile = MEMORY_FILE) {
    this.storageFile = storageFile;
    this.memory = [];
    this.loaded = false;
  }

  ensureStorage() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });

    if (!fs.existsSync(this.storageFile)) {
      this.memory = SEEDED_ITEMS.map((item) => normalizeMemoryItem(item));
      this.persist();
      return;
    }

    const raw = fs.readFileSync(this.storageFile, 'utf8').trim();
    if (!raw) {
      this.memory = SEEDED_ITEMS.map((item) => normalizeMemoryItem(item));
      this.persist();
    }
  }

  load() {
    if (this.loaded) return this.memory.map((item) => ({ ...item, text: memoryText(item) }));

    this.ensureStorage();
    const raw = fs.readFileSync(this.storageFile, 'utf8');
    const parsed = JSON.parse(raw || '{"items":[]}');
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    this.memory = items.map((item) => normalizeMemoryItem(item));
    this.loaded = true;
    logger.info('Loaded Stephanos memory store', { file: this.storageFile, items: this.memory.length });
    return this.memory.map((item) => ({ ...item, text: memoryText(item) }));
  }

  persist() {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      items: this.memory.map((item) => ({
        id: item.id,
        category: item.category,
        title: item.title,
        content: item.content,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        importance: item.importance,
        source: item.source,
      })),
    };

    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    fs.writeFileSync(this.storageFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  listMemory(filters = {}) {
    this.load();
    const category = normalizeText(filters.category || '').toLowerCase();
    const tags = normalizeTags(filters.tags || []);
    const items = this.memory.filter((item) => {
      const categoryMatch = !category || item.category === category;
      const tagsMatch = tags.length === 0 || tags.every((tag) => item.tags.includes(tag));
      return categoryMatch && tagsMatch;
    });

    return items
      .map((item) => ({ ...item, text: memoryText(item) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getById(id) {
    this.load();
    const item = this.memory.find((entry) => entry.id === id);
    if (!item) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, `Memory item '${id}' was not found.`, { status: 404 });
    return { ...item, text: memoryText(item) };
  }

  addMemoryItem(item) {
    this.load();
    const entry = normalizeMemoryItem(item);

    if (this.memory.some((existing) => existing.id === entry.id)) {
      throw createError(ERROR_CODES.CMD_INVALID, `Memory item '${entry.id}' already exists.`, { status: 409 });
    }

    this.memory.push(entry);
    this.persist();
    activityLogService.record({
      type: 'memory_item_saved',
      subsystem: 'memory_service',
      summary: `Saved memory ${entry.id}.`,
      payload: { id: entry.id, category: entry.category, tags: entry.tags },
    });
    logger.info('Saved memory entry', { id: entry.id, category: entry.category });
    return { ...entry, text: memoryText(entry) };
  }

  saveMemory(item) {
    if (typeof item === 'string') {
      return this.addMemoryItem({ title: item, content: item, category: 'project', source: 'slash-command' });
    }

    if (item?.text && !item.title && !item.content) {
      return this.addMemoryItem({
        title: item.text,
        content: item.text,
        category: item.category || 'project',
        tags: item.tags,
        importance: item.importance,
        source: item.source || 'slash-command',
        id: item.id,
        createdAt: item.created_at ?? item.createdAt,
      });
    }

    return this.addMemoryItem(item);
  }

  updateMemoryItem(id, patch = {}) {
    this.load();
    const index = this.memory.findIndex((entry) => entry.id === id);
    if (index < 0) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, `Memory item '${id}' was not found.`, { status: 404 });

    const existing = this.memory[index];
    const updated = normalizeMemoryItem({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }, { existing });

    this.memory[index] = updated;
    this.persist();
    activityLogService.record({
      type: 'memory_item_updated',
      subsystem: 'memory_service',
      summary: `Updated memory ${updated.id}.`,
      payload: { id: updated.id, category: updated.category, tags: updated.tags },
    });
    return { ...updated, text: memoryText(updated) };
  }

  deleteMemoryItem(id) {
    this.load();
    const index = this.memory.findIndex((entry) => entry.id === id);
    if (index < 0) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, `Memory item '${id}' was not found.`, { status: 404 });

    const [removed] = this.memory.splice(index, 1);
    this.persist();
    activityLogService.record({
      type: 'memory_item_deleted',
      subsystem: 'memory_service',
      summary: `Deleted memory ${removed.id}.`,
      payload: { id: removed.id, category: removed.category },
    });
    return { ...removed, text: memoryText(removed) };
  }

  searchMemory(query = '', options = {}) {
    const normalizedQuery = normalizeText(query).toLowerCase();
    const category = normalizeText(options.category || '').toLowerCase();
    const tags = normalizeTags(options.tags || []);
    const tokens = keywordTokens(normalizedQuery);

    return this.listMemory({ category, tags })
      .map((item) => ({ item, score: this.scoreMemoryItem(item, normalizedQuery, tokens) }))
      .filter(({ score }) => normalizedQuery ? score > 0 : true)
      .sort((a, b) => b.score - a.score || new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime())
      .map(({ item }) => item);
  }

  findMemory(query = '') {
    return this.searchMemory(query);
  }

  scoreMemoryItem(item, query = '', tokens = []) {
    const haystack = `${item.category} ${item.title} ${item.content} ${(item.tags || []).join(' ')}`.toLowerCase();
    let score = item.importance || DEFAULT_IMPORTANCE;

    if (query && haystack.includes(query)) {
      score += 8;
    }

    for (const token of tokens) {
      if (item.tags.includes(token)) score += 6;
      if (item.category === token) score += 5;
      if (item.title.toLowerCase().includes(token)) score += 4;
      if (item.content.toLowerCase().includes(token)) score += 2;
    }

    return score;
  }

  getRelevantMemory(query = '', options = {}) {
    const limit = Number(options.limit) > 0 ? Number(options.limit) : MEMORY_PROMPT_LIMIT;
    return this.searchMemory(query).slice(0, limit);
  }

  buildContextSummary(query = '', options = {}) {
    const relevantItems = this.getRelevantMemory(query, options);
    if (!relevantItems.length) {
      return {
        relevantItems: [],
        summaryText: '',
      };
    }

    const summaryText = relevantItems
      .map((item, index) => `${index + 1}. [${item.category}] ${item.title} — ${item.content} (tags: ${item.tags.join(', ') || 'none'}; importance: ${item.importance})`)
      .join('\n');

    return {
      relevantItems,
      summaryText,
    };
  }

  getStatus() {
    this.load();
    return {
      storage: this.storageFile,
      loaded: this.loaded,
      items: this.memory.length,
      categories: MEMORY_CATEGORIES,
    };
  }
}

export const memoryService = new MemoryService();
