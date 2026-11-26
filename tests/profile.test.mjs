import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jpeg from 'jpeg-js';
import { createProfileApi, hashCredential } from '../server/profile-api.mjs';

const endpoint = 'https://reservalab-ifce-bv.vercel.app/api/profile';
const password = 'teste-local-reservalab-foto';
const coordinator = { username: 'coordenacao.teste', name: 'Coordenação de Teste' };
const coordinatorConfig = JSON.stringify([{ ...coordinator, ...await hashCredential(password) }]);

function testService(config = coordinatorConfig) {
  const files = new Map();
  let revision = 0;
  const storage = {
    writesEnabled: true,
    async read(path) { return files.get(path) ?? null; },
    async write(path, body, type, options = {}) {
      if (!this.writesEnabled) throw new Error('Write failed');
      const previous = files.get(path);
      if (options.ifMatch && options.ifMatch !== previous?.etag || previous && !options.overwrite && !options.ifMatch) {
        const error = new Error('Write conflict');
        error.name = 'BlobPreconditionFailedError';
        throw error;
      }
      files.set(path, { body, etag: String(++revision) });
    },
    async remove(path) { files.delete(path); },
  };
  const signingKey = randomBytes(32).toString('base64url');
  let api = createProfileApi({ storage, signingKey, coordinatorConfig: config });

  function request(method, { token, fields, photo, resource, origin } = {}) {
    return api(new Request(endpoint + (resource ? '?resource=' + resource : ''), {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(fields ? { 'Content-Type': 'application/json' } : {}),
        ...(photo ? { 'Content-Type': 'image/jpeg' } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: fields ? JSON.stringify(fields) : photo,
    }));
  }
  const post = (action, fields = {}, token) => request('POST', { token, fields: { action, ...fields } });
  async function login(username) {
    const result = await post('login', { username, password });
    assert.equal(result.status, 200);
    return result.json();
  }
  async function invite(username, token) {
    const result = await post('invite', { username, name: 'Docente de Teste', role: 'coordinator' }, token);
    assert.equal(result.status, 201);
    return result.json();
  }
  async function teacher(username, coordinatorToken) {
    const { code } = await invite(username, coordinatorToken);
    const result = await post('activate', { username, code, password });
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.account.role, 'professor');
    return data.token;
  }
  return {
    request, post, login, invite, teacher, storage,
    restart: () => { api = createProfileApi({ storage, signingKey, coordinatorConfig: config }); },
  };
}

function image(red) {
  return jpeg.encode({ data: Uint8Array.of(red, 100, 40, 255), width: 1, height: 1 }, 90).data;
}

test('apresentação sem coordenação configurada mantém o servidor fechado', async () => {
  const { request, post } = testService('');
  const status = await request('GET', { resource: 'status' });
  assert.deepEqual(await status.json(), { enabled: false });
  assert.equal((await post('register')).status, 403);
  assert.equal((await post('invite')).status, 403);
  assert.equal((await request('PUT', { resource: 'photo', photo: image(10) })).status, 403);
});

test('cadastro aberto foi retirado e somente coordenação autenticada cria acessos docentes', async () => {
  const { post, login, teacher, request } = testService();
  assert.equal((await post('register', { username: 'docente', password })).status, 405);
  assert.equal((await post('invite', { username: 'docente', name: 'Docente' })).status, 401);
  assert.equal((await post('activate', { username: 'docente', password, code: 'a'.repeat(24) })).status, 401);
  const session = await login(coordinator.username);
  assert.equal(session.account.role, 'coordinator');
  const token = await teacher('docente.teste', session.token);
  assert.equal((await post('invite', { username: 'outro', name: 'Outro Docente' }, token)).status, 403);
  assert.equal((await request('GET', { token: session.token, resource: 'photo' })).status, 403);
  assert.equal((await post('invite', { username: 'docente.teste', name: 'Docente' }, session.token)).status, 409);
});

test('a coordenação pode reemitir código pendente e ele só pode ser usado uma vez', async () => {
  const { login, invite, post } = testService();
  const { token } = await login(coordinator.username);
  const first = await invite('novo.docente', token);
  const second = await invite('novo.docente', token);
  assert.notEqual(first.code, second.code);
  assert.equal((await post('activate', { username: first.username, code: first.code, password })).status, 401);
  const activate = () => post('activate', { username: second.username, code: second.code, password });
  const responses = await Promise.all([activate(), activate()]);
  assert.equal(responses.filter(response => response.ok).length, 1);
  assert.ok(responses.some(response => [401, 409].includes(response.status)));
  assert.equal((await activate()).status, 401);
});

test('cada docente pode alterar só o próprio nome e a própria foto', async () => {
  const { login, teacher, request, post, restart } = testService();
  const { token: coordinatorToken } = await login(coordinator.username);
  const first = await teacher('docente.um', coordinatorToken);
  const second = await teacher('docente.dois', coordinatorToken);
  assert.equal((await post('name', { name: 'Nome Atualizado', username: 'docente.dois' }, first)).status, 200);
  assert.equal((await request('PUT', { resource: 'photo', token: first, photo: image(45) })).status, 200);
  assert.equal((await request('GET', { resource: 'photo', token: second })).status, 204);
  assert.deepEqual(await (await request('GET', { resource: 'name', token: second })).json(), { name: 'Docente de Teste' });
  assert.equal((await request('GET', { resource: 'photo' })).status, 401);

  restart();
  const session = await login('docente.um');
  assert.deepEqual(await (await request('GET', { resource: 'name', token: session.token })).json(), { name: 'Nome Atualizado' });
  assert.equal((await request('GET', { resource: 'photo', token: session.token })).status, 200);
  assert.equal((await request('DELETE', { resource: 'photo', token: session.token })).status, 204);
  restart();
  assert.equal((await request('GET', { resource: 'photo', token: session.token })).status, 204);
});

test('imagem inválida ou falha ao trocar preserva a foto anterior', async () => {
  const { login, teacher, request, storage } = testService();
  const { token: coordinatorToken } = await login(coordinator.username);
  const token = await teacher('docente.foto', coordinatorToken);
  const photo = (method, body) => request(method, { resource: 'photo', token, photo: body });
  const initial = await photo('PUT', image(40));
  const original = Buffer.from(await initial.arrayBuffer());

  assert.equal((await photo('PUT', Buffer.from('<svg>'))).status, 422);
  assert.equal((await photo('PUT', Buffer.alloc(512 * 1024 + 1))).status, 413);
  storage.writesEnabled = false;
  assert.equal((await photo('PUT', image(200))).status, 503);
  assert.deepEqual(Buffer.from(await (await photo('GET')).arrayBuffer()), original);
});

test('autoriza a origem do Site e recusa origens desconhecidas', async () => {
  const { request } = testService();
  const sites = 'https://reservalab-ifce-boa-viagem.opal-yew-5148.chatgpt.site';
  const allowed = await request('OPTIONS', { origin: sites });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), sites);
  const unknown = await request('OPTIONS', { origin: 'https://example.com' });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.headers.get('access-control-allow-origin'), null);
});
