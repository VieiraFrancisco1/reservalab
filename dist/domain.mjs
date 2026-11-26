export const TIME_ZONE = 'America/Fortaleza';
export const USERS = Object.freeze([
  { id: 'ana', name: 'Ana Costa', role: 'professor', initials: 'AC' },
  { id: 'bruno', name: 'Bruno Lima', role: 'professor', initials: 'BL' },
  { id: 'camila', name: 'Camila Rocha', role: 'professor', initials: 'CR' },
  { id: 'rafael', name: 'Rafael Sousa', role: 'coordinator', initials: 'RS', lab: '1' },
  { id: 'juliana', name: 'Juliana Alves', role: 'coordinator', initials: 'JA', lab: '2' },
  { id: 'marcos', name: 'Marcos Santos', role: 'coordinator', initials: 'MS', lab: '3' },
]);
export const LABS = Object.freeze([
  { id: '1', name: 'Laboratório 1', number: '01', coordinator: 'rafael', color: 'green' },
  { id: '2', name: 'Laboratório 2', number: '02', coordinator: 'juliana', color: 'blue' },
  { id: '3', name: 'Laboratório 3', number: '03', coordinator: 'marcos', color: 'sand' },
]);
export const SLOTS = Object.freeze([
  { id: '0730', start: '07:30', end: '09:10', period: 'Manhã' },
  { id: '0930', start: '09:30', end: '11:10', period: 'Manhã' },
  { id: '1300', start: '13:00', end: '14:40', period: 'Tarde' },
  { id: '1500', start: '15:00', end: '16:40', period: 'Tarde' },
  { id: '1830', start: '18:30', end: '20:10', period: 'Noite' },
  { id: '2020', start: '20:20', end: '22:00', period: 'Noite' },
]);
export const userById = (id, users = USERS) => users.find(user => user.id === id);
export const labById = id => LABS.find(lab => lab.id === id);
export const slotById = id => SLOTS.find(slot => slot.id === id);
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function clock(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
export function dateObject(key) { return new Date(key + 'T12:00:00-03:00'); }
export function addDays(key, amount) {
  const date = new Date(key + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function availableDates(now = new Date()) {
  const start = todayKey(now);
  return Array.from({ length: 15 }, (_, index) => addDays(start, index))
    .filter(key => ![0, 6].includes(dateObject(key).getUTCDay()));
}
export function isPast(date, slotId, now = new Date()) {
  const slot = slotById(slotId);
  return !slot || date < todayKey(now) || (date === todayKey(now) && slot.start <= clock(now));
}
export function defaultDate(now = new Date()) {
  return availableDates(now).find(date => SLOTS.some(slot => !isPast(date, slot.id, now))) ?? availableDates(now)[0];
}
export function formatDate(key, options = {}) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, ...options }).format(dateObject(key));
}
export const bookingAt = (bookings, lab, date, slot) => bookings.find(b => b.lab === lab && b.date === date && b.slot === slot);
export function findTeacherConflict(bookings, input, editingId = null) {
  const target = slotById(input.slot);
  if (!target) return null;
  return bookings.find(b => {
    const existing = slotById(b.slot);
    return b.id !== editingId && b.teacher === input.teacher && b.date === input.date && existing
      && !(b.lab === input.lab && b.slot === input.slot)
      && existing.start < target.end && target.start < existing.end;
  }) ?? null;
}
export function applyBooking(bookings, actorId, input, { editingId = null, replaceIds = [], expectedUpdatedAt = null, now = new Date(), users = USERS } = {}) {
  const actor = userById(actorId, users);
  if (!actor) throw new Error('Entre com um perfil de professor.');
  const previous = editingId ? bookings.find(b => b.id === editingId) : null;
  if (editingId && !previous) throw new Error('Esta reserva mudou. Atualize a agenda.');
  if (previous && actor.role !== 'coordinator' && previous.teacher !== actor.id) throw new Error('Você só pode alterar suas próprias reservas.');
  if (previous && expectedUpdatedAt && expectedUpdatedAt !== previous.updatedAt) throw new Error('Esta reserva foi alterada em outra aba. Feche e abra novamente para conferir.');
  const teacher = userById(input.teacher, users);
  if (!labById(input.lab) || !slotById(input.slot) || !teacher) throw new Error('Selecione um laboratório, horário e professor válidos.');
  if (!availableDates(now).includes(input.date)) throw new Error('Escolha um dia útil dentro dos próximos 15 dias.');
  if (isPast(input.date, input.slot, now)) throw new Error('Este horário já começou. Escolha um próximo horário.');
  if (previous && isPast(previous.date, previous.slot, now)) throw new Error('Não é possível alterar uma reserva que já começou.');
  if (actor.role !== 'coordinator' && input.teacher !== actor.id) throw new Error('Você só pode reservar em seu próprio nome.');
  const conflict = bookingAt(bookings.filter(b => b.id !== editingId), input.lab, input.date, input.slot);
  const teacherConflict = findTeacherConflict(bookings, input, editingId);
  if (teacherConflict) {
    const error = new Error(`${teacher.name} já tem uma reserva no ${labById(teacherConflict.lab)?.name ?? 'outro laboratório'} neste horário.`);
    error.teacherConflict = teacherConflict;
    throw error;
  }
  if (conflict && (actor.role !== 'coordinator' || !replaceIds.includes(conflict.id))) {
    const error = new Error('Este horário já foi reservado. Confira a agenda antes de continuar.');
    error.conflict = conflict;
    throw error;
  }
  const booking = {
    id: previous?.id ?? globalThis.crypto.randomUUID(),
    lab: input.lab, date: input.date, slot: input.slot, teacher: input.teacher,
    subject: String(input.subject ?? '').trim().slice(0, 90),
    createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(), updatedBy: actor.id,
  };
  return { bookings: [...bookings.filter(b => b.id !== editingId && b.id !== conflict?.id), booking], booking, replaced: conflict ?? null };
}
export function cancelBooking(bookings, actorId, id, now = new Date(), users = USERS) {
  const actor = userById(actorId, users);
  const booking = bookings.find(b => b.id === id);
  if (!actor || !booking) throw new Error('A reserva não foi encontrada. Atualize a agenda.');
  if (actor.role !== 'coordinator' && booking.teacher !== actor.id) throw new Error('Você só pode cancelar suas próprias reservas.');
  if (isPast(booking.date, booking.slot, now)) throw new Error('Esta reserva já começou e não pode ser cancelada.');
  return bookings.filter(b => b.id !== id);
}
export function seedBookings(now = new Date()) {
  const dates = availableDates(now);
  const result = [];
  for (const [di, date] of dates.entries()) {
    for (const [li, lab] of LABS.entries()) {
      for (const [si, slot] of SLOTS.entries()) {
        const shouldBook = ((di * 3 + li * 2 + si) % 5 < 2) || (di === 3 && li === 1);
        if (!shouldBook) continue;
        const teacher = USERS[(di + li + si) % USERS.length];
        result.push({ id: `demo-${date}-${lab.id}-${slot.id}`, lab: lab.id, date, slot: slot.id, teacher: teacher.id,
          subject: ['Programação Web', 'Aula prática', 'Banco de Dados', 'Projeto Integrador', 'Redes de Computadores', 'Algoritmos'][(di + si) % 6],
          createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: teacher.id });
      }
    }
  }
  return result;
}
