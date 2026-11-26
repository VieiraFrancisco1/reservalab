import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jpeg from 'jpeg-js';
import { profileName } from '../dist/profile-rules.mjs';

const scryptAsync = promisify(scrypt);
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const maxPhotoBytes = 512 * 1024;
const sessionLifetime = 12 * 60 * 60;
const allowedOrigins = new Set([
  'https://reservalab-ifce-bv.vercel.app',
  'https://reservalab-ifce-boa-viagem.opal-yew-5148.chatgpt.site',
]);
const digest = value => createHash('sha256').update(value).digest('hex');
const accountKey = username => 'faculty/v1/' + digest(username) + '.json';
const usernameFor = input => typeof input === 'string' ? input.trim().toLowerCase() : '';

class ProfileError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ProfileError(413, 'O arquivo excede o limite de tamanho.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

const hashPassword = (password, salt) => scryptAsync(password, salt, 64, {
  N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024,
});

function validatePhoto(bytes) {
  try {
    const image = jpeg.decode(bytes, {
      maxResolutionInMP: 0.3,
      maxMemoryUsageInMB: 16,
      useTArray: true,
      tolerantDecoding: false,
    });
    if (!image.width || !image.height || image.width > 512 || image.height > 512) throw new Error();
    return jpeg.encode(image, 86).data;
  } catch {
    throw new ProfileError(422, 'A imagem é inválida. Selecione outro arquivo.');
  }
}

export async function hashCredential(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString('base64url'), digest: (await hashPassword(password, salt)).toString('base64url') };
}

function readCoordinators(value) {
  if (!value) return new Map();
  const records = JSON.parse(value);
  if (!Array.isArray(records) || !records.length) throw new Error('Configuração da coordenação inválida.');
  const coordinators = new Map();
  for (const record of records) {
    const username = usernameFor(record?.username);
    const name = profileName(record?.name);
    const salt = Buffer.from(record?.salt ?? '', 'base64url');
    const secret = Buffer.from(record?.digest ?? '', 'base64url');
    if (!usernamePattern.test(username) || !name || salt.length !== 16 || secret.length !== 64 || coordinators.has(username)) {
      throw new Error('Configuração da coordenação inválida.');
    }
    coordinators.set(username, {
      id: 'coord-' + digest(username + secret.toString('base64url')), username, name, role: 'coordinator',
      salt: salt.toString('base64url'), digest: secret.toString('base64url'),
    });
  }
  return coordinators;
}

async function bodyFields(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new ProfileError(415, 'Formato de acesso inválido.');
  }
  try {
    return JSON.parse(await readBody(request, 2048)) ?? {};
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError(400, 'Confira os dados do formulário.');
  }
}

export function createProfileApi({ storage, signingKey, coordinatorConfig, allowLocal = false }) {
  const key = Buffer.from(signingKey ?? '', 'base64url');
  let coordinators;
  try {
    coordinators = readCoordinators(coordinatorConfig);
  } catch {
    console.error('ReservaLab coordinator access configuration is invalid');
    coordinators = new Map();
  }
  const enabled = key.length >= 32 && coordinators.size > 0;
  const attempts = new Map();
  let rateWindowStart = 0;
  const sign = value => createHmac('sha256', key).update('reservalab/access/v2:' + value).digest();

  function sessionFor(account) {
    const { id, username, role, name } = account;
    const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetime;
    const payload = Buffer.from(JSON.stringify({ id, username, role, name, expiresAt })).toString('base64url');
    return { token: payload + '.' + sign(payload).toString('base64url'), account: { username, role, name } };
  }

  function authorize(request, role) {
    const match = /^Bearer ([\w-]{1,768})\.([\w-]{43})$/.exec(request.headers.get('authorization') ?? '');
    if (!match || !timingSafeEqual(Buffer.from(match[2], 'base64url'), sign(match[1]))) {
      throw new ProfileError(401, 'Entre com seu acesso restrito.');
    }
    const session = JSON.parse(Buffer.from(match[1], 'base64url'));
    if (session.expiresAt <= Math.floor(Date.now() / 1000) ||
      session.role === 'coordinator' && coordinators.get(session.username)?.id !== session.id) {
      throw new ProfileError(401, 'Sua sessão expirou. Entre novamente.');
    }
    if (session.role !== role) throw new ProfileError(403, 'Seu perfil não tem permissão para esta ação.');
    return session;
  }

  function rateLimit(request) {
    const now = Date.now();
    if (now - rateWindowStart >= 10 * 60_000) {
      attempts.clear();
      rateWindowStart = now;
    }
    const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const count = attempts.get(ip) ?? 0;
    if (count >= 20 || attempts.size >= 2048 && count === 0) {
      throw new ProfileError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
    attempts.set(ip, count + 1);
  }

  async function readRecord(path) {
    const value = await storage.read(path);
    return value ? { etag: value.etag, data: await new Response(value.body).json() } : null;
  }

  async function writeRecord(path, data, previous) {
    try {
      await storage.write(path, JSON.stringify(data), 'application/json', previous ? { ifMatch: previous.etag } : {});
    } catch (error) {
      if (error.name === 'BlobPreconditionFailedError' || !previous && await storage.read(path)) {
        throw new ProfileError(409, 'Este cadastro foi atualizado. Confira os dados e tente novamente.');
      }
      throw error;
    }
  }

  async function createAccess(fields) {
    const username = usernameFor(fields.username);
    const name = profileName(fields.name);
    if (!usernamePattern.test(username) || !name) {
      throw new ProfileError(400, 'Informe o nome do docente e um usuário válido de 3 a 40 caracteres.');
    }
    const path = accountKey(username);
    const previous = await readRecord(path);
    if (previous?.data.digest || coordinators.has(username)) {
      throw new ProfileError(409, 'Este usuário já possui acesso.');
    }
    const code = randomBytes(18).toString('base64url');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const account = {
      id: previous?.data.id ?? randomUUID(), username, name, role: 'professor',
      invitation: { digest: digest(code), expiresAt },
    };
    await writeRecord(path, account, previous);
    return { username, code };
  }

  async function authenticate(action, fields, request) {
    const username = usernameFor(fields.username);
    const password = fields.password;
    if (!usernamePattern.test(username) || typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 144) {
      throw new ProfileError(400, 'Confira o usuário e use uma senha de pelo menos 12 caracteres.');
    }
    rateLimit(request);
    const path = accountKey(username);
    if (action === 'activate') {
      const previous = await readRecord(path);
      const invitation = previous?.data.invitation;
      const code = typeof fields.code === 'string' ? fields.code.trim() : '';
      if (!invitation || invitation.expiresAt <= Date.now() || !/^[\w-]{24}$/.test(code) ||
        !timingSafeEqual(Buffer.from(invitation.digest, 'hex'), Buffer.from(digest(code), 'hex'))) {
        throw new ProfileError(401, 'O código é inválido ou expirou.');
      }
      const { id, name, role } = previous.data;
      const account = { id, username, name, role, ...await hashCredential(password) };
      await writeRecord(path, account, previous);
      return sessionFor(account);
    }

    const account = coordinators.get(username) ?? (await readRecord(path))?.data;
    const provided = await hashPassword(password, account?.digest ? Buffer.from(account.salt, 'base64url') : Buffer.alloc(16));
    if (!account?.digest || !timingSafeEqual(Buffer.from(account.digest, 'base64url'), provided)) {
      throw new ProfileError(401, 'Usuário ou senha inválidos. Ative o acesso se recebeu um código da coordenação.');
    }
    return sessionFor(account);
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = !origin || origin === url.origin || allowedOrigins.has(origin)
      || allowLocal && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (data, status = 200) => Response.json(data, { status, headers });
    try {
      if (!allowed) throw new ProfileError(403, 'Origem não autorizada.');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
        } });
      }

      const resource = url.searchParams.get('resource');
      if (request.method === 'GET' && resource === 'status') return respond({ enabled });
      if (!enabled) throw new ProfileError(403, 'O acesso restrito ainda não está habilitado.');
      if (request.method === 'POST') {
        const fields = await bodyFields(request);
        if (fields.action === 'login' || fields.action === 'activate') {
          return respond(await authenticate(fields.action, fields, request));
        }
        if (fields.action === 'invite') {
          authorize(request, 'coordinator');
          return respond(await createAccess(fields), 201);
        }
        if (fields.action === 'name') {
          const owner = authorize(request, 'professor');
          const name = profileName(fields.name);
          if (!name) throw new ProfileError(400, 'Informe um nome de 2 a 80 caracteres.');
          await storage.write('faculty-names/' + owner.id + '.json', JSON.stringify({ name }), 'application/json', { overwrite: true });
          return respond({ name });
        }
        throw new ProfileError(405, 'Operação indisponível.');
      }

      const owner = authorize(request, 'professor');
      if (resource === 'name' && request.method === 'GET') {
        const saved = await readRecord('faculty-names/' + owner.id + '.json');
        return respond({ name: saved?.data.name ?? owner.name });
      }
      if (resource !== 'photo') throw new ProfileError(404, 'Recurso indisponível.');
      const path = 'faculty-photos/' + owner.id + '.jpg';
      if (request.method === 'GET') {
        const photo = await storage.read(path);
        return photo ? new Response(photo.body, { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
          : new Response(null, { status: 204, headers });
      }
      if (request.method === 'PUT') {
        if (request.headers.get('content-type') !== 'image/jpeg') throw new ProfileError(415, 'Formato de imagem inválido.');
        const photo = validatePhoto(await readBody(request, maxPhotoBytes));
        await storage.write(path, photo, 'image/jpeg', { overwrite: true });
        return new Response(photo, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
      }
      if (request.method === 'DELETE') {
        await storage.remove(path);
        return new Response(null, { status: 204, headers });
      }
      throw new ProfileError(405, 'Operação indisponível.');
    } catch (error) {
      if (error instanceof ProfileError) return respond({ error: error.message }, error.status);
      console.error('ReservaLab access service failure', error?.name, error?.code);
      return respond({ error: 'O serviço de acesso está indisponível. Tente novamente.' }, 503);
    }
  };
}
