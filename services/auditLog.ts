const STORAGE_KEY = 'finova_audit_log_v1';
const MAX_ENTRIES = 400;

export type AuditEntity = 'transaction' | 'account' | 'goal' | 'budget' | 'liability' | 'asset';

export interface AuditLogEntry {
  id: string;
  at: string;
  action: 'create' | 'update' | 'delete';
  entity: AuditEntity;
  entityId?: string;
  summary: string;
  userId?: string;
}

function load(): AuditLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as AuditLogEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(entries: AuditLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {}
}

export function auditChangeLog(entry: Omit<AuditLogEntry, 'id' | 'at'> & { at?: string }): void {
  const full: AuditLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    summary: entry.summary.slice(0, 500),
    userId: entry.userId,
  };
  const prev = load();
  save([full, ...prev].slice(0, MAX_ENTRIES));
}

export function getAuditLog(limit = 100, filter?: { entity?: AuditEntity; action?: AuditLogEntry['action']; search?: string }): AuditLogEntry[] {
  let entries = load();
  if (filter?.entity) entries = entries.filter((e) => e.entity === filter.entity);
  if (filter?.action) entries = entries.filter((e) => e.action === filter.action);
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    entries = entries.filter((e) => e.summary.toLowerCase().includes(q) || e.entity.toLowerCase().includes(q));
  }
  return entries.slice(0, limit);
}

export function clearAuditLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function exportAuditLogAsCsv(entries: AuditLogEntry[]): string {
  const headers = ['Timestamp', 'Action', 'Entity', 'Summary'];
  const rows = entries.map((e) => [
    new Date(e.at).toISOString(),
    e.action,
    e.entity,
    (e.summary ?? '').replace(/"/g, '""'),
  ]);
  return [headers.join(','), ...rows.map((r) => r.map((c) => (c.includes(',') || c.includes('"') ? `"${c}"` : c)).join(','))].join('\n');
}
