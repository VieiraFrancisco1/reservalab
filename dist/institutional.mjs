import { avatar, mountProfileEditor, photoDataUrl } from './profile.mjs';
import { escapeHtml as h } from './ui.mjs';

const sitesHost = 'reservalab-ifce-boa-viagem.opal-yew-5148.chatgpt.site';
const endpoint = location.hostname === sitesHost
  ? 'https://reservalab-ifce-bv.vercel.app/api/profile'
  : '/api/profile';

async function accessRequest({ method = 'GET', resource, token, fields, photo } = {}) {
  const url = new URL(endpoint, location.origin);
  const headers = {};
  if (resource) url.searchParams.set('resource', resource);
  if (token) headers.Authorization = 'Bearer ' + token;
  if (fields) headers['Content-Type'] = 'application/json';
  if (photo) headers['Content-Type'] = 'image/jpeg';
  let response;
  try {
    response = await fetch(url, {
      method, headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      body: fields ? JSON.stringify(fields) : photo,
    });
  } catch {
    throw new Error('A conexão falhou. Tente novamente.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'O serviço de acesso está indisponível.');
  }
  return response;
}

export async function checkInstitutionalAccess() {
  try {
    const response = await accessRequest({ resource: 'status' });
    return (await response.json()).enabled === true;
  } catch {
    return false;
  }
}

function attachForm(form, handler) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const text = button.textContent;
    const error = form.querySelector('.form-error');
    const fields = Object.fromEntries(new FormData(form));
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Aguarde…';
    try {
      await handler(fields);
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = text;
    }
  });
}

const inputField = (id, label, name, attributes = '') => `<div class="field">
  <label for="${id}">${label}</label><input id="${id}" name="${name}" required ${attributes}>
</div>`;
const usernameField = () => inputField('restriction-username', 'Usuário', 'username',
  'minlength="3" maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false"');
const errorBox = '<div class="form-error" role="alert" hidden></div>';
const signOutButton = '<button type="button" class="button secondary" data-action="close">Sair</button>';

export function showInstitutionalAccess(host, activating = false) {
  const modal = host.showModal(`${host.closeButton()}<h2 id="modal-title">${activating ? 'Ativar acesso docente' : 'Acesso restrito'}</h2>
    <p class="modal-subtitle">${activating ? 'Use o código entregue pela coordenação e escolha sua senha.' : 'Entre com o usuário autorizado pela coordenação.'}</p>
    <form class="restricted-form">
      <div class="account-fields">
        ${usernameField()}
        ${activating ? inputField('activation-code', 'Código de ativação', 'code', 'autocomplete="one-time-code" maxlength="24"') : ''}
        ${inputField('restriction-password', 'Senha', 'password', `type="password" minlength="12" maxlength="72" autocomplete="${activating ? 'new-password' : 'current-password'}"`)}
      </div>
      ${errorBox}
      <div class="modal-actions">
        <button type="button" class="button secondary" data-access-mode>${activating ? 'Voltar' : 'Ativar acesso'}</button>
        <button type="submit" class="button primary">${activating ? 'Ativar' : 'Entrar'}</button>
      </div>
    </form>`);
  const form = modal.querySelector('form');
  modal.querySelector('[data-access-mode]').addEventListener('click', () => showInstitutionalAccess(host, !activating));
  attachForm(form, async fields => {
    const response = await accessRequest({ method: 'POST', fields: { ...fields, action: activating ? 'activate' : 'login' } });
    const session = await response.json();
    if (!form.isConnected || !modal.open) return;
    if (session.account.role === 'coordinator') showCoordinator(host, session);
    else showTeacher(host, session);
  });
}

function showCoordinator(host, session) {
  const modal = host.showModal(`${host.closeButton()}<h2 id="modal-title">Acessos docentes</h2>
    <p class="modal-subtitle">${h(session.account.name)} · Coordenação</p>
    <form class="restricted-form">
      <div class="account-fields">
        ${inputField('invite-name', 'Nome do docente', 'name', 'minlength="2" maxlength="80"')}
        ${usernameField()}
      </div>
      ${errorBox}
      <div class="modal-actions">${signOutButton}<button type="submit" class="button primary">Criar acesso</button></div>
    </form>
    <div class="invite-result" aria-live="polite" hidden></div>`);
  const form = modal.querySelector('form');
  const result = modal.querySelector('.invite-result');
  attachForm(form, async fields => {
    result.hidden = true;
    const response = await accessRequest({ method: 'POST', token: session.token, fields: { ...fields, action: 'invite' } });
    const invite = await response.json();
    result.innerHTML = `<strong>Acesso criado para ${h(invite.username)}</strong>
      <p>Entregue este código ao docente. Ele vale por sete dias.</p>
      <code>${h(invite.code)}</code>`;
    result.hidden = false;
    form.reset();
  });
}

async function showTeacher(host, session) {
  const modal = host.showModal(`${host.closeButton()}<h2 id="modal-title">Meu perfil docente</h2>
    <div class="account-detail" data-restricted-profile><p role="status">Carregando perfil…</p></div>
    <section class="profile-photo" hidden aria-label="Editar perfil"></section>
    <div class="modal-actions">${signOutButton}</div>`);
  const identity = modal.querySelector('[data-restricted-profile]');
  const root = modal.querySelector('.profile-photo');
  const { token } = session;
  try {
    const [nameResponse, photoResponse] = await Promise.all([
      accessRequest({ resource: 'name', token }), accessRequest({ resource: 'photo', token }),
    ]);
    let profile = {
      name: (await nameResponse.json()).name,
      photo: photoResponse.status === 204 ? '' : await photoDataUrl(await photoResponse.blob()),
    };
    if (!root.isConnected || !modal.open) return;
    const updateIdentity = () => {
      identity.innerHTML = `${avatar(profile, profile.photo, true)}<div>
        <strong>${h(profile.name)}</strong><span>Docente · ${h(session.account.username)}</span></div>`;
    };
    updateIdentity();
    root.hidden = false;
    host.setProfileCleanup(mountProfileEditor(root, profile, async changes => {
      if (Object.hasOwn(changes, 'photo')) {
        const response = changes.photo
          ? await accessRequest({ method: 'PUT', resource: 'photo', token, photo: changes.photo })
          : await accessRequest({ method: 'DELETE', resource: 'photo', token });
        profile = { ...profile, photo: changes.photo ? await photoDataUrl(await response.blob()) : '' };
      } else {
        const response = await accessRequest({ method: 'POST', token, fields: { name: changes.name, action: 'name' } });
        profile = { ...profile, name: (await response.json()).name };
      }
      updateIdentity();
      return profile;
    }));
  } catch (error) {
    identity.innerHTML = `<p class="form-error" role="alert">${h(error.message)}</p>
      <button type="button" class="button secondary" data-retry-profile>Tentar novamente</button>`;
    identity.querySelector('[data-retry-profile]').addEventListener('click', () => showTeacher(host, session));
  }
}
