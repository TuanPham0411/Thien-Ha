import {uploadPreview} from './media-preview.js';
import {uploadChunks} from "./uploads.js";

let listener;
let tester = sessionStorage.getItem('th-mes-tester') === 'true';
const watchers = new Set();
let loading = false;
export async function refreshRecords() {
  if (loading || !watchers.size || document.hidden) return;
  loading = true;
  const active = [...watchers];
  try {
    const result = await api("readBundle", { paths: active.map(w => ({ path: w.path, order: w.order })) });
    for (const w of active) if (watchers.has(w)) w.onData(result.snapshots[w.path].rows);
  } catch (error) { for (const w of active) if (watchers.has(w)) w.onError(error); }
  finally { loading = false; }
}
export function initializeBackend() {}
export async function api(name, data = {}) {
  const response = await fetch('/api/mes', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(tester ? { 'X-MES-Tester': 'true' } : {}) },
    body: JSON.stringify({ name, data }),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'), { code: body.code || 'unavailable' });
  if (!['getMyPendingTickets','getIncidentColors','saveIncidentColors','getDashboardDefaults','getDashboardPreferences','getAppearanceDefaults','getAppearancePreferences','read','readBundle','getDirectory','getSession','listDevices','downloadUrl','uploadUrl'].includes(name))
    setTimeout(refreshRecords, 0);
  return body;
}
export function watchAuth(callback) { listener = callback; setTimeout(async () => { try { await api('getSession'); await callback({ id: 'local' }); } catch { await callback(null); } }, 0); }
export async function ownerLogin() { location.href='/api/oauth/start'; }
export async function managedLogin() { tester = false; sessionStorage.removeItem('th-mes-tester'); await listener?.({ id: 'local' }); }
export async function setTesterMode(enabled) {
  tester = enabled;
  sessionStorage.setItem('th-mes-tester', String(enabled));
  await listener?.({ id: 'local' });
}
export async function logout() {
  try { await api('logout'); } finally { tester = false; sessionStorage.removeItem('th-mes-tester'); await listener?.(null); }
}
export function watchRecords(path, onData, onError, order) {
  const watcher = { path, onData, onError, order };
  watchers.add(watcher);
  setTimeout(refreshRecords, 0);
  return () => {
    watchers.delete(watcher);
  };
}
export async function uploadAttachment(path, file, type) {
  await uploadChunks({kind:'ticket',path,file,type,headers:tester?{'X-MES-Tester':'true'}:{}});
  await uploadPreview('ticket',path,file,tester?{'X-MES-Tester':'true'}:{});
}
export async function downloadAttachment(path) {
  const { url } = await api('downloadUrl', { path });
  const response = await fetch(url);
  if (!response.ok) throw new Error('Attachment download failed');
  return response.blob();
}
