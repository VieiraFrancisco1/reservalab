import { del, get, put } from '@vercel/blob';
import { createProfileApi } from '../server/profile-api.mjs';

const token = process.env.BLOB_READ_WRITE_TOKEN;
const storage = {
  async read(path) {
    const result = await get(path, { access: 'private', token, useCache: false });
    return result?.stream ? { body: result.stream, etag: result.blob.etag } : null;
  },
  write(path, body, contentType, { overwrite = false, ifMatch } = {}) {
    return put(path, body, {
      access: 'private', token, contentType, addRandomSuffix: false,
      allowOverwrite: overwrite || Boolean(ifMatch), ifMatch,
    });
  },
  remove(path) {
    return del(path, { token });
  },
};

const handle = createProfileApi({
  storage,
  signingKey: process.env.RESERVALAB_PROFILE_SIGNING_KEY,
  coordinatorConfig: process.env.RESERVALAB_COORDINATORS,
});
export default { fetch: handle };
