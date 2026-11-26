import test from 'node:test';
import assert from 'node:assert/strict';
import { availableDates, todayKey, addDays, isPast, applyBooking, cancelBooking, seedBookings, USERS, LABS, SLOTS } from '../dist/domain.mjs';

const now = new Date('2026-11-12T15:00:00Z');
const input = { lab: '1', date: '2026-11-13', slot: '0730', teacher: 'ana', subject: 'Programação Web' };
const options = { now };
const create = (overrides = {}, actor = 'ana') => applyBooking([], actor, { ...input, ...overrides }, options).booking;

test('15 dias corridos: inclui o 15º dia e exclui fins de semana', () => {
  const dates = availableDates(now);
  assert.equal(dates[0], '2026-11-12');
  assert.equal(dates.at(-1), '2026-11-26');
  assert.equal(dates.length, 11);
  assert.ok(dates.every(date => ![0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay())));
  assert.ok(!dates.includes(addDays(todayKey(now), 15)));
});
test('a data do campus usa Fortaleza mesmo na virada do dia UTC', () => {
  assert.equal(todayKey(new Date('2026-11-13T01:59:00Z')), '2026-11-12');
  assert.equal(todayKey(new Date('2026-11-13T03:00:00Z')), '2026-11-13');
});
test('quando começa no sábado, a agenda inicia na segunda e mantém o limite de 15 dias', () => {
  const saturday = new Date('2026-11-14T15:00:00Z');
  const dates = availableDates(saturday);
  assert.equal(dates[0], '2026-11-16');
  assert.equal(dates.at(-1), '2026-11-27');
  assert.equal(dates.length, 10);
});
test('professor reserva horário livre em seu próprio nome', () => {
  const result = applyBooking([], 'ana', input, options);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.booking.teacher, 'ana');
});
test('professor não reserva em nome de outro professor', () => {
  assert.throws(() => create({ teacher: 'bruno' }), /próprio nome/);
});
test('professor não substitui reserva existente, mesmo informando autorização no cliente', () => {
  const booking = create({}, 'ana');
  assert.throws(() => applyBooking([booking], 'bruno', { ...input, teacher: 'bruno' }, { ...options, replaceIds: [booking.id] }), /já foi reservado/);
});
test('não permite duas reservas no mesmo laboratório, data e horário', () => {
  const booking = create();
  assert.throws(() => applyBooking([booking], 'ana', input, options), /já foi reservado/);
  assert.equal([booking].length, 1);
});
test('cada um dos três coordenadores pode reservar em qualquer laboratório para qualquer professor', () => {
  for (const actor of USERS.filter(u => u.role === 'coordinator')) {
    for (const lab of LABS) {
      assert.equal(create({ lab: lab.id, teacher: 'bruno' }, actor.id).teacher, 'bruno');
    }
  }
});
test('coordenador precisa confirmar exatamente a reserva que será substituída', () => {
  const booking = create();
  assert.throws(() => applyBooking([booking], 'rafael', { ...input, teacher: 'bruno' }, options), /já foi reservado/);
  assert.throws(() => applyBooking([booking], 'rafael', { ...input, teacher: 'bruno' }, { ...options, replaceIds: ['outro-id'] }), /já foi reservado/);
  const result = applyBooking([booking], 'rafael', { ...input, teacher: 'bruno' }, { ...options, replaceIds: [booking.id] });
  assert.equal(result.bookings.length, 1);
  assert.equal(result.booking.teacher, 'bruno');
  assert.equal(result.replaced.id, booking.id);
});
test('troca de laboratório ou horário preserva a identidade da reserva e libera a origem', () => {
  const booking = create();
  const result = applyBooking([booking], 'juliana', { ...input, lab: '3', slot: '1300', teacher: 'camila' }, { ...options, editingId: booking.id });
  assert.equal(result.bookings.length, 1);
  assert.equal(result.booking.id, booking.id);
  assert.equal(result.booking.lab, '3');
  assert.equal(result.booking.slot, '1300');
  assert.equal(result.booking.teacher, 'camila');
});
test('movimentar para um horário ocupado só altera os dados após confirmar a substituição', () => {
  const source = create();
  const target = create({ lab: '2' });
  const original = [source, target];
  assert.throws(() => applyBooking(original, 'marcos', { ...input, lab: '2' }, { ...options, editingId: source.id }), /já foi reservado/);
  assert.equal(original.length, 2);
  const result = applyBooking(original, 'marcos', { ...input, lab: '2' }, { ...options, editingId: source.id, replaceIds: [target.id] });
  assert.equal(result.bookings.length, 1);
  assert.equal(result.booking.id, source.id);
});
test('professor cancela apenas suas reservas; coordenador cancela qualquer reserva futura', () => {
  const booking = create();
  assert.throws(() => cancelBooking([booking], 'bruno', booking.id, now), /próprias reservas/);
  assert.equal(cancelBooking([booking], 'ana', booking.id, now).length, 0);
  assert.equal(cancelBooking([booking], 'marcos', booking.id, now).length, 0);
});
test('professor remarca a própria reserva e não altera reservas de outro professor', () => {
  const booking = create();
  const result = applyBooking([booking], 'ana', { ...input, slot: '1300' }, { ...options, editingId: booking.id });
  assert.equal(result.booking.slot, '1300');
  assert.equal(result.booking.id, booking.id);
  assert.throws(() => applyBooking([booking], 'bruno', { ...input, teacher: 'bruno' }, { ...options, editingId: booking.id }), /próprias reservas/);
});
test('sábado, domingo, data anterior e o 16º dia são recusados', () => {
  for (const date of ['2026-11-14', '2026-11-15', '2026-11-11', '2026-11-27']) {
    assert.throws(() => create({ date }), /próximos 15 dias/);
  }
  assert.equal(create({ date: '2026-11-26' }).date, '2026-11-26');
});
test('horário iniciado não pode ser reservado, editado nem cancelado', () => {
  const booking = { ...create(), date: '2026-11-12', slot: '0730' };
  assert.ok(isPast(booking.date, booking.slot, now));
  assert.throws(() => create({ date: booking.date, slot: booking.slot }), /já começou/);
  assert.throws(() => cancelBooking([booking], 'rafael', booking.id, now), /já começou/);
  assert.throws(() => applyBooking([booking], 'rafael', input, { ...options, editingId: booking.id }), /já começou/);
});
test('usuário, laboratório, professor e horário inválidos são recusados', () => {
  assert.throws(() => create({}, 'intruso'), /perfil/);
  for (const invalid of [{ lab: '4' }, { teacher: 'intruso' }, { slot: '0000' }]) {
    assert.throws(() => create(invalid), /válidos/);
  }
});
test('editar ou cancelar reserva removida em outra aba não recria dados silenciosamente', () => {
  assert.throws(() => applyBooking([], 'rafael', input, { ...options, editingId: 'removida' }), /mudou/);
  assert.throws(() => cancelBooking([], 'ana', 'removida', now), /não foi encontrada/);
});
test('dados demonstrativos têm seis perfis, três coordenadores e reservas sem duplicação', () => {
  assert.equal(USERS.filter(u => u.role === 'coordinator').length, 3);
  const data = seedBookings(now);
  assert.equal(new Set(data.map(b => [b.lab, b.date, b.slot].join('/'))).size, data.length);
  assert.ok(data.every(b => availableDates(now).includes(b.date) && SLOTS.some(s => s.id === b.slot)));
});


test('professor não pode ficar em dois laboratórios no mesmo horário', () => {
  const booking = create();
  assert.throws(() => applyBooking([booking], 'ana', { ...input, lab: '2' }, options), /já tem uma reserva/);
});
test('coordenador também respeita a disponibilidade do professor', () => {
  const booking = create();
  assert.throws(() => applyBooking([booking], 'rafael', { ...input, lab: '3' }, options), /já tem uma reserva/);
});
test('horários diferentes e professores diferentes podem usar laboratórios em paralelo', () => {
  const booking = create();
  assert.equal(applyBooking([booking], 'ana', { ...input, lab: '2', slot: '0930' }, options).bookings.length, 2);
  assert.equal(applyBooking([booking], 'bruno', { ...input, lab: '2', teacher: 'bruno' }, options).bookings.length, 2);
});
test('professor pode mover sua reserva para outro laboratório sem conflito consigo mesmo', () => {
  const booking = create();
  const result = applyBooking([booking], 'ana', { ...input, lab: '2' }, { ...options, editingId: booking.id });
  assert.equal(result.booking.lab, '2');
  assert.equal(result.bookings.length, 1);
});
test('professor não muda o titular da própria reserva', () => {
  const booking = create();
  assert.throws(() => applyBooking([booking], 'ana', { ...input, teacher: 'bruno' }, { ...options, editingId: booking.id }), /próprio nome/);
});
test('uma edição antiga não sobrescreve uma reserva atualizada em outra aba', () => {
  const booking = { ...create(), updatedAt: '2026-11-12T15:01:00.000Z' };
  assert.throws(() => applyBooking([booking], 'ana', { ...input, slot: '1300' }, { ...options, editingId: booking.id, expectedUpdatedAt: '2026-11-12T15:00:00.000Z' }), /alterada em outra aba/);
});
