import { seedBookings } from './domain.mjs';

// Adapter boundary: replace these methods with authenticated Firebase operations.
// This demo stores data only in this browser and does not provide secure authentication.
const KEY = 'reservalab:bookings:v1';
export const SESSION_KEY = 'reservalab:demo-user:v1';
let fallback = null;
export function readBookings() {
  if (fallback) return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('Invalid local data');
      return data.filter(b => b && typeof b.id === 'string' && typeof b.date === 'string' && typeof b.lab === 'string' && typeof b.slot === 'string' && typeof b.teacher === 'string');
    }
    const initial = seedBookings();
    localStorage.setItem(KEY, JSON.stringify(initial));
    return initial;
  } catch {
    return fallback ??= seedBookings();
  }
}
export function writeBookings(bookings) {
  try { localStorage.setItem(KEY, JSON.stringify(bookings)); }
  catch { fallback = bookings; return false; }
  return true;
}
export function readSession() { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } }
export function writeSession(id) { try { id ? sessionStorage.setItem(SESSION_KEY, id) : sessionStorage.removeItem(SESSION_KEY); } catch { /* Session remains in memory. */ } }
export function subscribe(callback) {
  const listener = event => { if (event.key === KEY) callback(readBookings()); };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
