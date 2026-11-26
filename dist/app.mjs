import { LABS, SLOTS, addDays, userById, labById, slotById, todayKey, availableDates, defaultDate, isPast, formatDate, bookingAt, applyBooking, cancelBooking, findTeacherConflict } from './domain.mjs';
import { readBookings, writeBookings, readSession, writeSession, subscribe } from './store.mjs';
import { escapeHtml as h, icon, statusPill } from './ui.mjs';
import { avatar, mountProfileEditor, photoDataUrl } from './profile.mjs';
import { addDemoTeacher, demoUsers, subscribeDemoProfiles, updateDemoProfile } from './demo-profiles.mjs';
import { checkInstitutionalAccess, showInstitutionalAccess } from './institutional.mjs';

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const dateShort = date => formatDate(date, { day: '2-digit', month: 'short' }).replace('.', '').replace(' de ', ' ');
const dateLong = date => capitalize(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }));
const getDemoUser = id => userById(id, users);
const professorName = id => getDemoUser(id)?.name ?? 'Professor';
const roleLabel = user => user.role === 'coordinator' ? 'Coordenação' : 'Docente';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let bookings = readBookings();
let users = demoUsers();
let currentUser = getDemoUser(readSession());
let page = 'home';
let labId = '1';
let selectedDate = defaultDate();
let period = 'Todos';
let onlyFree = false;
let reservationLab = 'all';
let reservationDate = 'all';
let reservationScope = 'all';
let bookingContext = null;
let draggedBooking = null;
let highlightedSlot = null;
let toastTimer;
let disposeProfile = null;
let institutionalAvailable = false;

function brand() {
  return `<img class="brand-mark" src="./favicon.svg" width="42" height="42" alt="">
    <span class="brand-copy"><strong>ReservaLab</strong><small>IFCE · Boa Viagem</small></span>`;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.className = `visible ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => { element.className = ''; }, 4500);
}
function navigate(target) {
  if (location.hash === '#' + target) route();
  else location.hash = target;
}
function route() {
  const parts = location.hash.slice(1).split('/');
  page = parts[0] === 'reservas' ? 'reservas' : 'home';
  if (parts[0] === 'agenda') {
    if (labById(parts[1])) labId = parts[1];
    if (availableDates().includes(parts[2])) selectedDate = parts[2];
  }
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function selectAgenda(lab, date) {
  labId = lab; selectedDate = date; page = 'home';
  history.replaceState(null, '', '#agenda/' + labId + '/' + selectedDate);
  render();
}
function disposeModalProfile() {
  disposeProfile?.();
  disposeProfile = null;
}
function closeModal() { disposeModalProfile(); modal.close(); bookingContext = null; }
function showModal(html, large = false) {
  disposeModalProfile();
  if (modal.open) modal.close();
  modal.className = large ? 'wide-modal' : '';
  modal.innerHTML = `<div class="modal-body">${html}</div>`;
  modal.showModal();
  return modal;
}
const closeButton = () => `<button type="button" class="modal-close" data-action="close" aria-label="Fechar janela">${icon('close')}</button>`;
const profileDescription = user => user.role === 'coordinator'
  ? 'Pode gerenciar reservas nos três laboratórios.'
  : 'Pode reservar e alterar seus próprios horários.';

function loginView() {
  app.innerHTML = `<div class="login-page">
    <header class="login-top"><a href="#home" class="brand">${brand()}</a><span class="demo-label">Demonstração</span></header>
    <main id="main" class="login-main">
      <section class="login-card">
        <h1>Acesso dos professores</h1>
        <p>Consulte a agenda e reserve um laboratório.</p>
        <form id="login-form">
          <label for="demo-profile">Perfil de demonstração</label>
          <div class="select-wrap"><select name="profile" id="demo-profile" aria-describedby="profile-description">
            ${['professor', 'coordinator'].map(role => `
              <optgroup label="${role === 'professor' ? 'Docentes' : 'Coordenação'}">
                ${users.filter(user => user.role === role).map(user => `<option value="${user.id}">${h(user.name)} — ${roleLabel(user)}</option>`).join('')}
              </optgroup>`).join('')}
          </select></div>
          <p id="profile-description" class="profile-description">${profileDescription(users[0])}</p>
          <button class="button primary login-submit" type="submit">Entrar</button>
        </form>
        <p class="login-demo">Escolha um perfil para testar. Os dados da apresentação ficam neste navegador.</p>
        <button type="button" class="text-button institutional-access" data-action="institutional-access"${institutionalAvailable ? '' : ' hidden'}>Acesso restrito</button>
      </section>
    </main>
    <footer class="login-footer">Instituto Federal do Ceará · Campus Boa Viagem</footer>
  </div>`;
}
function header() {
  const dates = availableDates();
  const coordinator = currentUser.role === 'coordinator';
  const count = bookings.filter(b => (coordinator || b.teacher === currentUser.id) && dates.includes(b.date) && !isPast(b.date, b.slot)).length;
  return `<header class="site-header"><div class="header-inner">
    <a class="brand" href="#home">${brand()}</a>
    <nav class="main-nav" aria-label="Navegação principal">
      <a href="#home" ${page === 'home' ? 'class="active" aria-current="page"' : ''}>${icon('calendar')}Reservar</a>
      <a href="#reservas" ${page === 'reservas' ? 'class="active" aria-current="page"' : ''}>
        ${icon('list')}${coordinator ? 'Reservas' : 'Minhas reservas'}<span class="nav-count">(${count})</span>
      </a>
    </nav>
    <div class="header-actions">
      <button class="demo-label" data-action="demo-info">Demonstração</button>
      <button class="profile-button" data-action="account" aria-label="Perfil de ${h(currentUser.name)}">
        ${avatar(currentUser, currentUser.photo)}
        <span class="profile-text"><strong>${h(currentUser.name)}</strong><small>${roleLabel(currentUser)}</small></span>
      </button>
    </div>
  </div></header>`;
}
function rangeLabel() {
  const dates = availableDates();
  return `${dateShort(dates[0])} a ${dateShort(dates.at(-1))}`;
}
function labSummary(lab, date) {
  const usable = SLOTS.filter(slot => !isPast(date, slot.id));
  const free = usable.filter(slot => !bookingAt(bookings, lab.id, date, slot.id));
  return { usable, free, status: usable.length ? (free.length ? 'available' : 'occupied') : 'ended', label: usable.length ? (free.length ? 'Disponível' : 'Cheio') : 'Encerrado' };
}
function bookingView() {
  const lab = labById(labId);
  const dates = availableDates();
  const free = labSummary(lab, selectedDate).free.length;
  const slots = SLOTS.filter(slot => (period === 'Todos' || slot.period === period) && (!onlyFree || !isPast(selectedDate, slot.id) && !bookingAt(bookings, labId, selectedDate, slot.id)));
  const draggable = currentUser.role === 'coordinator' && !onlyFree
    && slots.some(slot => !isPast(selectedDate, slot.id) && bookingAt(bookings, labId, selectedDate, slot.id));
  return `<section class="page-heading">
    <div><h1>Agenda dos laboratórios</h1><p>Escolha o laboratório e o dia.</p></div>
    <span class="window-label">${icon('calendar')}<span>Próximos 15 dias <strong>${rangeLabel()}</strong></span></span>
  </section>
  <section class="lab-choices" aria-label="Escolha o laboratório">${LABS.map(item => {
    const summary = labSummary(item, selectedDate);
    const countLabel = summary.free.length === 1 ? 'horário livre' : 'horários livres';
    return `<button class="lab-choice ${item.id === labId ? 'selected' : ''}" data-action="lab" data-lab="${item.id}"
      aria-label="${item.name}, ${summary.label}, ${summary.free.length} ${countLabel}" aria-pressed="${item.id === labId}">
      <span class="lab-choice-top">${icon('lab')}<strong class="lab-title"><span class="desktop-label">Laboratório</span><span class="mobile-label">Lab.</span> ${item.id}</strong></span>
      <span class="lab-choice-bottom">${statusPill(summary.label, summary.status)}
        <span class="free-count"><strong>${summary.free.length}</strong> <span class="desktop-label">${countLabel}</span><span class="mobile-label">${summary.free.length === 1 ? 'livre' : 'livres'}</span></span>
      </span>
    </button>`;
  }).join('')}</section>
  <section class="agenda-board" aria-label="Agenda do ${lab.name}">
    <div class="board-top">
      <div><h2>${lab.name}</h2><p>Coordenação: ${h(professorName(lab.coordinator))}</p></div>
      <span class="board-info">${icon('calendar')}Segunda a sexta</span>
    </div>
    <div class="date-picker">
      <div class="date-picker-heading">Escolha o dia</div>
      <div class="days-strip" aria-label="Dias da agenda">${dates.map(date => `
        <button class="day-card ${selectedDate === date ? 'selected' : ''}" data-action="day" data-date="${date}"
          aria-label="${dateLong(date)}" aria-pressed="${selectedDate === date}">
          <span>${formatDate(date, { weekday: 'short' }).replace('.', '')}</span>
          <strong>${formatDate(date, { day: '2-digit' })}</strong>
          <small>${date === todayKey() ? 'Hoje' : formatDate(date, { month: 'short' }).replace('.', '')}</small>
        </button>`).join('')}</div>
    </div>
    <div class="daily-heading">
      <div><h3>${dateLong(selectedDate)}</h3><p><strong>${free}</strong> ${free === 1 ? 'horário livre' : 'horários livres'}</p></div>
      <label class="free-toggle"><input id="only-free" type="checkbox" ${onlyFree ? 'checked' : ''}>Só horários livres</label>
    </div>
    <div class="schedule-toolbar">
      <div class="period-filters" aria-label="Filtrar por turno">${['Todos', 'Manhã', 'Tarde', 'Noite'].map(value => `
        <button data-action="period" data-value="${value}" class="${period === value ? 'active' : ''}"
          aria-pressed="${period === value}">${value}</button>`).join('')}</div>
      <div class="legend">${statusPill('Livre', 'available')}${statusPill('Reservado', 'occupied')}</div>
    </div>
    ${draggable ? '<p class="drag-help">Arraste uma reserva até outro horário ou selecione Alterar.</p>' : ''}
    <div class="schedule-list">${slots.length ? slots.map(slot => slotRow(lab, slot)).join('') : `
      <div class="empty-state compact"><span class="state-icon">${icon('clock')}</span>
        <h3>Nenhum horário disponível</h3><p>Escolha outro dia, laboratório ou turno.</p>
        <button class="button secondary" data-action="clear-filters">Limpar filtros</button>
      </div>`}
    </div>
  </section>`;
}
function slotRow(lab, slot) {
  const booking = bookingAt(bookings, lab.id, selectedDate, slot.id);
  const past = isPast(selectedDate, slot.id);
  const mine = booking?.teacher === currentUser.id;
  const coordinator = currentUser.role === 'coordinator';
  const manageable = booking && !past && (mine || coordinator);
  const destination = coordinator && !past
    ? ` data-drop-slot="${slot.id}" data-drop-lab="${lab.id}" data-drop-date="${selectedDate}"`
    : '';
  const draggable = booking && destination ? ` draggable="true" data-drag-booking="${h(booking.id)}"` : '';
  const status = past ? statusPill('Encerrado', 'ended')
    : booking ? statusPill('Reservado', 'occupied') : statusPill('Livre', 'available');
  const action = booking ? `<button class="button small ${manageable ? 'secondary' : 'quiet'}" data-action="booking-detail"
    data-id="${h(booking.id)}">${manageable ? 'Alterar' : 'Detalhes'}</button>`
    : past ? '' : `<button class="button small reserve-button" data-action="reserve" data-lab="${lab.id}"
      data-date="${selectedDate}" data-slot="${slot.id}">Reservar</button>`;
  return `<article class="slot-row ${past ? 'past' : booking ? 'occupied' : 'available'}"${destination}${draggable}>
    <div class="slot-time"><strong>${slot.start} – ${slot.end}</strong><small>${slot.period}</small></div>
    <div class="slot-description">${status}${booking ? `
      <div class="teacher-label"><strong>${h(professorName(booking.teacher))}</strong>${mine ? '<span class="mine-tag">Sua reserva</span>' : ''}</div>
      ${booking.subject ? `<span class="booking-subject">${h(booking.subject)}</span>` : ''}` : ''}</div>
    <div class="slot-action">${action}</div>
  </article>`;
}
function sortBookings(a, b) { return (a.date + a.slot + a.lab).localeCompare(b.date + b.slot + b.lab); }
function reservationsView() {
  const coordinator = currentUser.role === 'coordinator';
  const dates = availableDates();
  const upcoming = bookings.filter(b => labById(b.lab) && dates.includes(b.date) && !isPast(b.date, b.slot)
    && (coordinator || b.teacher === currentUser.id));
  const filtersActive = reservationLab !== 'all' || reservationDate !== 'all';
  const list = upcoming.filter(b =>
    (coordinator && reservationScope === 'all' || b.teacher === currentUser.id)
    && (reservationLab === 'all' || b.lab === reservationLab)
    && (reservationDate === 'all' || b.date === reservationDate)).sort(sortBookings);
  const groups = new Map();
  for (const booking of list) {
    if (!groups.has(booking.date)) groups.set(booking.date, []);
    groups.get(booking.date).push(booking);
  }
  const emptyTitle = filtersActive ? 'Nenhuma reserva com esses filtros'
    : coordinator && reservationScope === 'all' ? 'Nenhuma reserva agendada' : 'Você ainda não tem reservas';
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  return `<section class="page-heading">
    <div><h1>${coordinator ? 'Reservas do campus' : 'Minhas reservas'}</h1>
      <p>${coordinator ? 'Consulte os horários agendados nos três laboratórios.' : 'Consulte, remarque ou cancele seus horários.'}</p></div>
    <a class="button primary" href="#home">${icon('plus')}Nova reserva</a>
  </section>
  <section class="reservations-panel" aria-label="Reservas agendadas">
    <div class="reservations-toolbar">
      <div class="reservations-filters">
        ${coordinator ? `<div class="reservation-filter"><span>Exibir</span><div class="scope-filter" aria-label="Exibir reservas">
          <button data-action="scope" data-value="all" class="${reservationScope === 'all' ? 'active' : ''}" aria-pressed="${reservationScope === 'all'}">Todas</button>
          <button data-action="scope" data-value="mine" class="${reservationScope === 'mine' ? 'active' : ''}" aria-pressed="${reservationScope === 'mine'}">Minhas</button>
        </div></div>` : ''}
        <div class="reservation-filter"><label for="reservation-lab">Laboratório</label>
          <div class="select-wrap"><select id="reservation-lab">
            <option value="all">Todos</option>
            ${LABS.map(lab => `<option value="${lab.id}" ${reservationLab === lab.id ? 'selected' : ''}>${lab.name}</option>`).join('')}
          </select></div>
        </div>
        <div class="reservation-filter"><label for="reservation-date">Dia</label>
          <div class="select-wrap"><select id="reservation-date">
            <option value="all">Todos os dias</option>
            ${dates.map(date => `<option value="${date}" ${reservationDate === date ? 'selected' : ''}>${formatDate(date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</option>`).join('')}
          </select></div>
        </div>
      </div>
      <p class="reservations-result" aria-live="polite"><strong>${list.length}</strong> ${list.length === 1 ? 'reserva' : 'reservas'}</p>
    </div>
    ${groups.size ? `<div class="reservation-groups">${[...groups].map(([date, items]) => `
      <section class="reservation-day" aria-labelledby="reservations-${date}">
        <header class="reservation-day-heading">
          ${icon('calendar')}
          <h2 id="reservations-${date}">${dateLong(date)}</h2>
          ${date === today || date === tomorrow ? `<span class="relative-date">${date === today ? 'Hoje' : 'Amanhã'}</span>` : ''}
        </header>
        <div class="reservations-list">${items.map(reservationRow).join('')}</div>
      </section>`).join('')}</div>` : `
      <div class="empty-state"><span class="state-icon">${icon('calendar')}</span><h3>${emptyTitle}</h3>
        ${filtersActive ? '<button class="button secondary" data-action="reset-reservation-filters">Limpar filtros</button>'
          : '<p>Consulte a agenda para encontrar um horário livre.</p><a class="button secondary" href="#home">Ver horários</a>'}
      </div>`}
  </section>`;
}
function reservationRow(booking) {
  const slot = slotById(booking.slot);
  const lab = labById(booking.lab);
  if (!slot || !lab) return '';
  return `<article class="reservation-row">
    <div class="reservation-time">${icon('clock')}<strong>${slot.start} – ${slot.end}</strong></div>
    <div class="reservation-info">
      <strong>${lab.name}</strong>
      ${currentUser.role === 'coordinator' ? `<span>${h(professorName(booking.teacher))}</span>` : ''}
      ${booking.subject ? `<span class="reservation-subject">${h(booking.subject)}</span>` : ''}
    </div>
    ${statusPill('Confirmada', 'confirmed')}
    <button class="button small secondary" data-action="booking-detail" data-id="${h(booking.id)}">Alterar</button>
  </article>`;
}
function render() {
  if (draggedBooking) endBookingDrag();
  if (!availableDates().includes(selectedDate)) selectedDate = defaultDate();
  if (reservationDate !== 'all' && !availableDates().includes(reservationDate)) reservationDate = 'all';
  if (!currentUser) { loginView(); return; }
  app.innerHTML = `${header()}<main class="main-content" id="main">${page === 'reservas' ? reservationsView() : bookingView()}<footer class="app-footer"><span>IFCE · Campus Boa Viagem</span><span>Horários e perfis demonstrativos</span></footer></main>`;
  if (page !== 'reservas') requestAnimationFrame(() => {
    const strip = document.querySelector('.days-strip');
    const selected = strip?.querySelector('.selected');
    if (strip && selected) strip.scrollLeft = selected.offsetLeft - strip.offsetLeft - (strip.clientWidth - selected.clientWidth) / 2;
  });
}
function bookingSummary(booking) {
  const slot = slotById(booking.slot);
  return `<div class="booking-summary">${icon('calendar')}<div>
    <strong>${labById(booking.lab)?.name ?? 'Laboratório'}</strong>
    <span>${dateLong(booking.date)}</span><strong>${slot?.start ?? ''} – ${slot?.end ?? ''}</strong>
  </div></div>`;
}
function selectField(name, label, options) {
  return `<div class="field"><label for="booking-${name}">${label}</label><div class="select-wrap"><select name="${name}" id="booking-${name}">${options}</select></div></div>`;
}
function openBooking(lab, date, slot, id = null, moving = null) {
  bookings = readBookings();
  const existing = id ? bookings.find(b => b.id === id) : bookingAt(bookings, lab, date, slot);
  if (id && !existing) { render(); toast('Esta reserva mudou. Confira a agenda.', true); return; }
  if (moving && (existing.updatedAt !== moving.updatedAt || isPast(existing.date, existing.slot)
      || isPast(date, slot) || !availableDates().includes(date))) {
    render();
    toast('A reserva ou o horário mudou. Confira a agenda e tente novamente.', true);
    return;
  }
  if (existing && !moving) { lab = existing.lab; date = existing.date; slot = existing.slot; }
  const coordinator = currentUser.role === 'coordinator';
  const past = isPast(date, slot);
  const mine = existing?.teacher === currentUser.id;
  const editable = !past && (coordinator || !existing || mine);
  const context = { id: existing?.id ?? null, lab, date, slot, updatedAt: existing?.updatedAt ?? null };
  let fields = '';
  if (editable && (coordinator || existing)) {
    fields = `<div class="form-grid">${selectField('lab', 'Laboratório', LABS.map(item => `<option value="${item.id}" ${item.id === lab ? 'selected' : ''}>${item.name}</option>`).join(''))}${selectField('date', 'Dia', availableDates().map(item => `<option value="${item}" ${item === date ? 'selected' : ''}>${formatDate(item, { weekday: 'short', day: '2-digit', month: '2-digit' })}</option>`).join(''))}${selectField('slot', 'Horário', SLOTS.map(item => `<option value="${item.id}" ${item.id === slot ? 'selected' : ''}>${item.start} – ${item.end}</option>`).join(''))}${coordinator ? selectField('teacher', 'Professor(a)', users.map(item => `<option value="${item.id}" ${item.id === (existing?.teacher ?? currentUser.id) ? 'selected' : ''}>${h(item.name)}</option>`).join('')) : `<input type="hidden" name="teacher" value="${currentUser.id}">`}</div>`;
  } else if (editable) {
    fields = `<input type="hidden" name="lab" value="${lab}"><input type="hidden" name="date" value="${date}"><input type="hidden" name="slot" value="${slot}"><input type="hidden" name="teacher" value="${currentUser.id}">`;
  }
  const title = moving ? 'Mover reserva' : existing ? editable ? 'Alterar reserva' : 'Detalhes da reserva' : 'Confirmar reserva';
  const editor = existing?.updatedBy ? `<p class="last-update">Última alteração por ${h(professorName(existing.updatedBy))}</p>` : '';
  showModal(`${closeButton()}<h2 id="modal-title">${title}</h2><p class="modal-subtitle">${editable ? existing ? 'Escolha o novo horário e salve.' : 'Confira o dia e o horário antes de reservar.' : 'Informações do horário reservado.'}</p>${bookingSummary({ lab, date, slot })}${editable ? `<form id="booking-form"><div class="form-error" role="alert" hidden></div>${fields}${!coordinator ? `<div class="professor-line">Professor(a): <strong>${h(currentUser.name)}</strong></div>` : ''}<div class="field subject-field"><label for="booking-subject">Turma ou disciplina <span>(opcional)</span></label><input name="subject" id="booking-subject" maxlength="90" placeholder="Ex.: Programação Web · ADS" value="${h(existing?.subject ?? '')}"></div><div id="conflict-warning"></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close">Voltar</button><button class="button primary" type="submit">${existing ? 'Salvar alterações' : 'Reservar horário'}</button></div></form>` : `<div class="detail-teacher"><div><small>Professor(a) responsável</small><strong>${h(professorName(existing?.teacher))}</strong>${existing?.subject ? `<span>${h(existing.subject)}</span>` : ''}</div></div><p class="read-only-note">${past ? 'Este horário já começou. Disponível apenas para consulta.' : 'Para ajustar esta reserva, procure a coordenação do laboratório.'}</p><button class="button secondary full-width" data-action="close">Fechar</button>`}${editor}${existing && !past && (mine || coordinator) ? `<button class="cancel-reservation" data-action="cancel-request" data-id="${h(existing.id)}">Cancelar reserva</button>` : ''}`, editable && (coordinator || Boolean(existing)));
  bookingContext = context;
  if (editable) updateConflict();
}
function updateConflict() {
  const form = document.querySelector('#booking-form');
  if (!form || !bookingContext) return;
  const data = Object.fromEntries(new FormData(form));
  const fresh = readBookings();
  const conflict = bookingAt(fresh.filter(b => b.id !== bookingContext.id), data.lab, data.date, data.slot);
  const teacherConflict = findTeacherConflict(fresh, data, bookingContext.id);
  const warning = document.querySelector('#conflict-warning');
  const coordinator = currentUser.role === 'coordinator';
  let message = '';
  if (teacherConflict) {
    message = `<div class="conflict-box"><div><strong>O professor já tem uma aula neste horário.</strong><p>${h(professorName(data.teacher))} · ${labById(teacherConflict.lab).name}. ${coordinator ? 'Escolha outro horário ou professor.' : 'Escolha outro horário.'}</p></div></div>`;
  } else if (conflict) {
    message = `<div class="conflict-box"><div><strong>Horário reservado por ${h(professorName(conflict.teacher))}.</strong><p>${coordinator ? 'Ao confirmar, a reserva atual será substituída.' : 'Escolha um horário livre para remarcar.'}</p>${coordinator ? `<label class="checkbox-label"><input type="checkbox" id="replace-consent" data-conflict="${h(conflict.id)}">Confirmo a substituição desta reserva</label>` : ''}</div></div>`;
  }
  warning.innerHTML = message;
  form.querySelector('button[type="submit"]').disabled = Boolean(teacherConflict || conflict && !coordinator);
  const summary = modal.querySelector('.booking-summary');
  if (summary) summary.outerHTML = bookingSummary(data);
}
function showCancel(id) {
  const booking = readBookings().find(b => b.id === id);
  if (!booking) { closeModal(); render(); toast('A reserva já foi removida.', true); return; }
  showModal(`${closeButton()}<h2 id="modal-title">Cancelar esta reserva?</h2><p class="modal-subtitle">O horário ficará disponível para outros professores.</p>${bookingSummary(booking)}<p class="cancel-professor">${h(professorName(booking.teacher))}</p><div class="form-error" role="alert" hidden></div><div class="modal-actions"><button class="button secondary" data-action="booking-detail" data-id="${h(id)}">Manter reserva</button><button class="button danger" data-action="cancel-confirm" data-id="${h(id)}">Sim, cancelar</button></div>`);
}
function accountModal() {
  const coordinator = currentUser.role === 'coordinator';
  const ownerId = currentUser.id;
  showModal(`${closeButton()}<h2 id="modal-title">${h(currentUser.name)}</h2>
    <div class="account-detail">
      <div data-profile-avatar>${avatar(currentUser, currentUser.photo, true)}</div>
      <div><strong>${roleLabel(currentUser)}</strong>
        <span>${coordinator ? `Responsável pelo ${labById(currentUser.lab).name.toLowerCase()}` : 'IFCE · Campus Boa Viagem'}</span></div>
    </div>
    <p class="read-only-note">${coordinator ? 'Você pode gerenciar reservas nos três laboratórios.' : 'Você pode reservar, remarcar e cancelar seus horários.'}</p>
    ${coordinator ? '<button class="button primary manage-teachers" data-action="demo-teachers">Gerenciar docentes</button>'
      : '<section class="profile-photo" id="profile-editor" aria-label="Editar perfil"></section>'}
    <div class="modal-actions"><button class="button secondary" data-action="logout">Trocar perfil</button></div>`);
  if (coordinator) return;
  disposeProfile = mountProfileEditor(modal.querySelector('#profile-editor'), currentUser, async changes => {
    const profile = updateDemoProfile(ownerId, Object.hasOwn(changes, 'photo')
      ? { photo: changes.photo ? await photoDataUrl(changes.photo) : '' }
      : { name: changes.name });
    if (currentUser?.id === ownerId) {
      users = demoUsers();
      currentUser = getDemoUser(ownerId);
      const avatarContainer = modal.querySelector('[data-profile-avatar]');
      if (avatarContainer) {
        avatarContainer.innerHTML = avatar(currentUser, currentUser.photo, true);
        modal.querySelector('#modal-title').textContent = currentUser.name;
      }
      render();
    }
    return profile;
  });
}
function showDemoTeachers() {
  if (currentUser?.role !== 'coordinator') return;
  const teachers = users.filter(user => user.role === 'professor').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  showModal(`${closeButton()}<h2 id="modal-title">Gerenciar docentes</h2>
    <p class="modal-subtitle">Os docentes de teste aparecem na tela inicial deste navegador.</p>
    <form id="demo-teacher-form" class="profile-name-form">
      <div class="field"><label for="new-demo-teacher">Nome do docente</label>
        <input name="name" id="new-demo-teacher" required minlength="2" maxlength="80" placeholder="Nome para a apresentação">
      </div>
      <button type="submit" class="button primary">Adicionar docente</button>
      <div class="form-error" role="alert" hidden></div>
    </form>
    <section class="teacher-directory" aria-label="Docentes da apresentação">
      <h3>Docentes <span class="count-label">${teachers.length}</span></h3>
      <ul>${teachers.map(teacher => `<li>${avatar(teacher)}<strong>${h(teacher.name)}</strong></li>`).join('')}</ul>
    </section>
    <div class="modal-actions"><button class="button secondary" data-action="account">Voltar ao perfil</button></div>`);
}
function showDemoInfo() {
  showModal(`${closeButton()}<h2 id="modal-title">Sobre a demonstração</h2>
    <p class="modal-subtitle">Os nomes, horários e reservas são fictícios.</p>
    <div class="demo-info-list">
      <p>Professores podem reservar, remarcar e cancelar os próprios horários. A coordenação gerencia os três laboratórios.</p>
      <p>A agenda inclui os próximos 15 dias corridos e mostra apenas dias úteis.</p>
      <p>As reservas e os perfis da apresentação ficam neste navegador.</p>
    </div><button class="button primary full-width" data-action="close">Fechar</button>`);
}

function highlightDropSlot(slot) {
  if (slot === highlightedSlot) return;
  highlightedSlot?.classList.remove('drop-target');
  highlightedSlot = slot;
  highlightedSlot?.classList.add('drop-target');
}

function endBookingDrag() {
  draggedBooking = null;
  highlightDropSlot(null);
}

app.addEventListener('dragstart', event => {
  const row = event.target.closest('[data-drag-booking]');
  if (!row || currentUser?.role !== 'coordinator') return;
  const booking = bookings.find(item => item.id === row.dataset.dragBooking);
  if (!booking || isPast(booking.date, booking.slot)) {
    event.preventDefault();
    return;
  }
  draggedBooking = booking;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', booking.id);
});

app.addEventListener('dragover', event => {
  if (!draggedBooking) return;
  const row = event.target.closest('[data-drop-slot]');
  const target = row && row.dataset.dragBooking !== draggedBooking.id ? row : null;
  highlightDropSlot(target);
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});

app.addEventListener('dragleave', event => {
  if (highlightedSlot?.contains(event.target) && !highlightedSlot.contains(event.relatedTarget)) {
    highlightDropSlot(null);
  }
});

app.addEventListener('drop', event => {
  const row = event.target.closest('[data-drop-slot]');
  const source = draggedBooking;
  if (!source || !row || row.dataset.dragBooking === source.id || currentUser?.role !== 'coordinator') return;
  event.preventDefault();
  endBookingDrag();
  const { dropLab, dropDate, dropSlot } = row.dataset;
  openBooking(dropLab, dropDate, dropSlot, source.id, source);
});

app.addEventListener('dragend', endBookingDrag);

function enter(form) {
  currentUser = getDemoUser(new FormData(form).get('profile'));
  if (!currentUser) return;
  writeSession(currentUser.id);
  page = 'home';
  navigate('home');
}

document.addEventListener('click', event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); const main = document.querySelector('#main'); main.setAttribute('tabindex', '-1'); main.focus(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close') { closeModal(); return; }
  if (action === 'institutional-access' && institutionalAvailable) {
    showInstitutionalAccess({ showModal, closeButton, setProfileCleanup: cleanup => { disposeProfile = cleanup; } });
    return;
  }
  if (!currentUser) return;
  if (action === 'day') selectAgenda(labId, button.dataset.date);
  if (action === 'lab') selectAgenda(button.dataset.lab, selectedDate);
  if (action === 'clear-filters') { period = 'Todos'; onlyFree = false; render(); }
  if (action === 'period') { period = button.dataset.value; render(); }
  if (action === 'scope') {
    reservationScope = button.dataset.value;
    render();
    document.querySelector('[data-action="scope"][aria-pressed="true"]')?.focus();
  }
  if (action === 'reset-reservation-filters') {
    reservationLab = reservationDate = 'all';
    render();
    document.querySelector('#reservation-lab')?.focus();
  }
  if (action === 'account') accountModal();
  if (action === 'demo-teachers') showDemoTeachers();
  if (action === 'demo-info') showDemoInfo();
  if (action === 'logout') {
    closeModal();
    currentUser = null;
    writeSession(null);
    page = 'home';
    period = 'Todos';
    onlyFree = false;
    reservationScope = 'all';
    reservationLab = 'all';
    reservationDate = 'all';
    history.replaceState(null, '', location.pathname + location.search);
    render();
  }
  if (action === 'reserve') openBooking(button.dataset.lab, button.dataset.date, button.dataset.slot);
  if (action === 'booking-detail') openBooking(null, null, null, button.dataset.id);
  if (action === 'cancel-request') showCancel(button.dataset.id);
  if (action === 'cancel-confirm') {
    try {
      bookings = cancelBooking(readBookings(), currentUser.id, button.dataset.id, new Date(), users);
      const saved = writeBookings(bookings);
      closeModal(); render(); toast(saved ? 'Reserva cancelada. O horário está livre novamente.' : 'Reserva cancelada nesta sessão. O navegador não permitiu salvar.', !saved);
    } catch (error) { const el = modal.querySelector('.form-error'); el.hidden = false; el.textContent = error.message; }
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'only-free') { onlyFree = event.target.checked; render(); document.querySelector('#only-free')?.focus(); }
  if (event.target.id === 'reservation-lab' || event.target.id === 'reservation-date') {
    const { id, value } = event.target;
    if (id === 'reservation-lab') reservationLab = value;
    else reservationDate = value;
    render();
    document.getElementById(id)?.focus();
  }
  if (event.target.id === 'demo-profile') {
    const user = getDemoUser(event.target.value);
    document.querySelector('#profile-description').textContent = profileDescription(user);
  }
  if (event.target.closest('#booking-form') && event.target.tagName === 'SELECT') updateConflict();
});
document.addEventListener('submit', event => {
  if (event.target.id === 'login-form') {
    event.preventDefault();
    enter(event.target);
    return;
  }
  if (event.target.id === 'demo-teacher-form') {
    event.preventDefault();
    try {
      const name = addDemoTeacher(currentUser?.id, new FormData(event.target).get('name'));
      users = demoUsers();
      showDemoTeachers();
      toast(`${name} já aparece na seleção de perfis.`);
    } catch (error) {
      const box = event.target.querySelector('.form-error');
      box.textContent = error.message;
      box.hidden = false;
    }
    return;
  }
  if (event.target.id !== 'booking-form') return;
  event.preventDefault();
  const errorBox = event.target.querySelector('.form-error');
  try {
    const input = Object.fromEntries(new FormData(event.target));
    const consent = document.querySelector('#replace-consent');
    const replaceIds = consent?.checked ? [consent.dataset.conflict] : [];
    const result = applyBooking(readBookings(), currentUser.id, input, {
      editingId: bookingContext.id, replaceIds, expectedUpdatedAt: bookingContext.updatedAt, users,
    });
    bookings = result.bookings;
    const saved = writeBookings(bookings);
    selectedDate = result.booking.date; labId = result.booking.lab;
    const edited = Boolean(bookingContext.id);
    closeModal(); onlyFree = false; period = 'Todos';
    if (page !== 'reservas') history.replaceState(null, '', '#agenda/' + labId + '/' + selectedDate);
    render();
    toast(saved ? result.replaced ? 'Reserva substituída. A agenda foi atualizada.' : edited ? 'Reserva atualizada.' : 'Reserva confirmada.' : 'Reserva feita nesta sessão. O navegador não permitiu salvar.', !saved);
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    if (error.conflict && currentUser.role === 'coordinator') { updateConflict(); errorBox.textContent = 'O horário está ocupado. Revise e confirme a substituição abaixo.'; }
    errorBox.scrollIntoView({ block: 'nearest' });
  }
});
modal.addEventListener('click', event => {
  if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); }
});
modal.addEventListener('close', () => {
  if (!modal.open) {
    bookingContext = null;
    disposeModalProfile();
  }
});
window.addEventListener('hashchange', route);
subscribe(data => { bookings = data; if (!modal.open) render(); });
setInterval(() => { if (currentUser && !modal.open) { bookings = readBookings(); render(); } }, 60000);
subscribeDemoProfiles(() => {
  users = demoUsers();
  currentUser = currentUser && getDemoUser(currentUser.id);
  if (!modal.open) render();
});
route();
checkInstitutionalAccess().then(available => {
  institutionalAvailable = available;
  const trigger = app.querySelector('.institutional-access');
  if (trigger) trigger.hidden = !available;
});
