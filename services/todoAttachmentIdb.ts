/**
 * Binary task attachments live in IndexedDB (localStorage stays small).
 * Keys: `${todoId}|${attachmentId}` → Blob
 */

const DB = 'finova_todo_attachments_v1';
const STORE = 'files';

export const MAX_TODO_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TODO = 5;

function key(todoId: string, attachmentId: string): string {
  return `${todoId}|${attachmentId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
  });
}

export async function putTodoAttachmentBlob(todoId: string, attachmentId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key(todoId, attachmentId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('put failed'));
  });
  db.close();
}

export async function getTodoAttachmentBlob(todoId: string, attachmentId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key(todoId, attachmentId));
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function deleteTodoAttachmentBlob(todoId: string, attachmentId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key(todoId, attachmentId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Remove all blobs for a task (call when task deleted). */
export async function deleteAllAttachmentsForTodo(todoId: string): Promise<void> {
  try {
    const db = await openDb();
    const prefix = `${todoId}|`;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const r = store.openCursor();
      r.onsuccess = () => {
        const cur = r.result;
        if (cur) {
          const k = String(cur.key);
          if (k.startsWith(prefix)) cur.delete();
          cur.continue();
        }
      };
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
