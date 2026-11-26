import test from 'node:test';
import assert from 'node:assert/strict';
import { addDemoTeacher, demoUsers, updateDemoProfile } from '../dist/demo-profiles.mjs';
import { applyBooking, cancelBooking } from '../dist/domain.mjs';

test('a coordenação pode adicionar um docente de apresentação que entra, edita o nome e reserva', () => {
  const state = new Map();
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: key => state.get(key) ?? null, setItem: (key, value) => state.set(key, value),
  }, configurable: true });
  assert.throws(() => addDemoTeacher('ana', 'Docente Novo'), /coordenação/);
  addDemoTeacher('rafael', 'Docente Novo');
  const teacher = demoUsers().find(user => user.name === 'Docente Novo');
  assert.equal(teacher.role, 'professor');
  updateDemoProfile(teacher.id, { name: 'Docente Atualizado' });
  assert.equal(demoUsers().find(user => user.id === teacher.id).name, 'Docente Atualizado');
  assert.equal(demoUsers().find(user => user.id === 'ana').name, 'Ana Costa');
  const users = demoUsers();
  const now = new Date('2026-11-25T11:00:00Z');
  const { booking } = applyBooking([], teacher.id, {
    lab: '1', date: '2026-11-26', slot: '0730', teacher: teacher.id,
  }, { now, users });
  assert.equal(booking.teacher, teacher.id);
  assert.deepEqual(cancelBooking([booking], teacher.id, booking.id, now, users), []);
});
