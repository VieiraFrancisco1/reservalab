import { USERS } from './domain.mjs';
import { profileName } from './profile-rules.mjs';

const profileKey = 'reservalab:demo-profiles:v1';
const customId = /^demo-docente-[a-f0-9-]{36}$/;
const jpegUrl = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

function readChanges() {
  try {
    const records = JSON.parse(localStorage.getItem(profileKey));
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  } catch {
    return {};
  }
}

function saveChanges(records) {
  try {
    localStorage.setItem(profileKey, JSON.stringify(records));
  } catch {
    throw new Error('O navegador não conseguiu salvar o perfil. Libere espaço e tente novamente.');
  }
}

export function demoUsers() {
  const records = readChanges();
  const created = Object.entries(records)
    .filter(([id, data]) => customId.test(id) && profileName(data?.name))
    .map(([id, data]) => ({ id, name: data.name, role: 'professor' }));
  return [...USERS, ...created].map(user => {
    const data = records[user.id];
    return user.role === 'professor'
      ? { ...user, name: profileName(data?.name) || user.name, photo: jpegUrl.test(data?.photo ?? '') ? data.photo : '' }
      : user;
  });
}

export function addDemoTeacher(actorId, name) {
  if (!demoUsers().some(user => user.id === actorId && user.role === 'coordinator')) {
    throw new Error('A coordenação cadastra os docentes.');
  }
  const validName = profileName(name);
  if (!validName) throw new Error('Informe um nome de 2 a 80 caracteres.');
  const id = 'demo-docente-' + crypto.randomUUID();
  saveChanges({ ...readChanges(), [id]: { name: validName } });
  return validName;
}

export function updateDemoProfile(actorId, changes) {
  const person = demoUsers().find(user => user.id === actorId && user.role === 'professor');
  if (!person) throw new Error('Selecione um perfil docente.');
  const records = readChanges();
  const { name = person.name, photo = person.photo } = changes;
  if (!profileName(name) || photo && !jpegUrl.test(photo)) throw new Error('Confira os dados do perfil.');
  saveChanges({ ...records, [actorId]: { name: profileName(name), photo } });
  return demoUsers().find(user => user.id === actorId);
}

export function subscribeDemoProfiles(callback) {
  window.addEventListener('storage', event => {
    if (event.key === profileKey) callback();
  });
}
