import initSqlJs from './sql-wasm/sql-wasm.js';

const SQL = await initSqlJs({
  locateFile: f => chrome.runtime.getURL('sql-wasm/' + f)
});

// --- OPFS helpers ---
async function readDbBytesFromOPFS(name) {
  const root = await navigator.storage.getDirectory();
  try {
    const handle = await root.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return new Uint8Array(0); // first run
  }
}

async function writeDbBytesToOPFS(name, bytes) {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

// --- open DB (persisted across Chrome restarts) ---
const DB_NAME = 'app.sqlite';
const bytes = await readDbBytesFromOPFS(DB_NAME);
const db = new SQL.Database(bytes.length ? bytes : undefined);

// Schema & seed (idempotent)
db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  );
`);

// Persist to OPFS after any mutation
async function persist() {
  const data = db.export();                // Uint8Array
  await writeDbBytesToOPFS(DB_NAME, data);
}

// --- message API ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'ADD_TODO') {
        db.run('INSERT INTO todos (title) VALUES (?)', [msg.title]);
        await persist();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'TOGGLE_TODO') {
        db.run('UPDATE todos SET done = 1 - done WHERE id = ?', [msg.id]);
        await persist();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'LIST_TODOS') {
        const res = db.exec('SELECT * FROM todos ORDER BY id DESC');
        const rows = res[0]?.values ?? [];
        // Optionally return column names: res[0]?.columns
        sendResponse({ ok: true, rows });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  // Keep the message channel open for async work
  return true;
});