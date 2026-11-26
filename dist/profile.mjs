import { escapeHtml as h, icon } from './ui.mjs';
import { profileName } from './profile-rules.mjs';

const formats = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxSourceBytes = 5 * 1024 * 1024;

function initials(name) {
  const words = name.trim().split(/\s+/u);
  return (Array.from(words[0])[0] + (words.length > 1 ? Array.from(words.at(-1))[0] : '')).toLocaleUpperCase('pt-BR');
}

export function avatar(user, photo = '', large = false) {
  return `<span class="avatar${large ? ' large' : ''}" aria-hidden="true">
    <span>${h(initials(user.name))}</span>
    ${photo ? `<img src="${h(photo)}" alt="" draggable="false">` : ''}
  </span>`;
}

async function preparePhoto(file) {
  if (!formats.has(file.type)) throw new Error('Selecione uma imagem JPG, PNG ou WebP.');
  if (!file.size || file.size > maxSourceBytes) throw new Error('Selecione uma imagem de até 5 MB.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 32_000_000) throw new Error();
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(side, 512);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!photo) throw new Error();
    return photo;
  } catch {
    throw new Error('Não foi possível abrir a imagem. Selecione outro arquivo.');
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function photoDataUrl(photo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('Não foi possível preparar a foto.')));
    reader.readAsDataURL(photo);
  });
}

export function mountProfileEditor(root, profile, update) {
  let current = profile;
  let pendingPhoto = null;
  let previewUrl = '';
  let active = true;
  let busy = false;

  root.innerHTML = `<h3>Editar perfil</h3>
    <form class="profile-name-form">
      <div class="field"><label for="profile-display-name">Nome de exibição</label>
        <input id="profile-display-name" name="name" required minlength="2" maxlength="80" value="${h(current.name)}">
      </div>
      <button type="submit" class="button secondary">Salvar nome</button>
    </form>
    <div class="profile-photos">
      <h3>Foto de perfil</h3>
      <p>JPG, PNG ou WebP de até 5 MB.</p>
      <div class="photo-actions">
        <input class="file-input" type="file" id="profile-photo-file" accept="image/jpeg,image/png,image/webp">
        <label class="button secondary photo-picker" for="profile-photo-file">${icon('camera')}<span data-pick-label></span></label>
        <button type="button" class="text-button remove-photo">Remover foto</button>
      </div>
      <div class="photo-preview" hidden>
        <div data-preview-avatar></div><strong>Prévia da nova foto</strong>
      </div>
      <div class="photo-actions photo-save" hidden>
        <button type="button" class="button primary" data-save-photo>Salvar foto</button>
        <button type="button" class="button quiet" data-discard-photo>Cancelar prévia</button>
      </div>
      <p class="photo-progress" role="status"></p>
      <div class="form-error" role="alert" hidden></div>
    </div>`;

  const form = root.querySelector('.profile-name-form');
  const input = root.querySelector('#profile-photo-file');
  const remove = root.querySelector('.remove-photo');
  const notice = root.querySelector('[role="status"]');
  const error = root.querySelector('[role="alert"]');
  const preview = root.querySelector('.photo-preview');
  const savePhoto = root.querySelector('[data-save-photo]');
  const discard = root.querySelector('[data-discard-photo]');

  function refresh() {
    root.querySelector('[data-pick-label]').textContent = current.photo ? 'Trocar foto' : 'Adicionar foto';
    remove.hidden = !current.photo || Boolean(pendingPhoto);
    preview.hidden = !pendingPhoto;
    root.querySelector('.photo-save').hidden = !pendingPhoto;
    root.querySelector('[data-preview-avatar]').innerHTML = previewUrl ? avatar(current, previewUrl, true) : '';
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    pendingPhoto = null;
    input.value = '';
  }

  async function run(label, operation) {
    if (busy || !active) return;
    busy = true;
    error.hidden = true;
    notice.textContent = label;
    for (const control of root.querySelectorAll('button, input')) control.disabled = true;
    try {
      const message = await operation();
      notice.textContent = message ?? '';
    } catch (failure) {
      notice.textContent = '';
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      busy = false;
      for (const control of root.querySelectorAll('button, input')) control.disabled = false;
      if (active) refresh();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = profileName(new FormData(form).get('name'));
    run('Salvando nome…', async () => {
      if (!name) throw new Error('Informe um nome de 2 a 80 caracteres.');
      current = await update({ name });
      return 'Nome atualizado.';
    });
  });

  input.addEventListener('change', () => {
    const [file] = input.files;
    if (!file) return;
    run('Preparando prévia…', async () => {
      clearPreview();
      const photo = await preparePhoto(file);
      if (active) {
        pendingPhoto = photo;
        previewUrl = URL.createObjectURL(photo);
      }
    }).then(() => {
      if (active && pendingPhoto) savePhoto.focus();
    });
  });

  discard.addEventListener('click', () => {
    clearPreview();
    error.hidden = true;
    notice.textContent = '';
    refresh();
    input.focus();
  });

  savePhoto.addEventListener('click', () => {
    if (!pendingPhoto) return;
    run('Salvando foto…', async () => {
      current = await update({ photo: pendingPhoto });
      clearPreview();
      return 'Foto salva.';
    });
  });

  remove.addEventListener('click', () => {
    run('Removendo foto…', async () => {
      current = await update({ photo: null });
      return 'Foto removida.';
    });
  });

  refresh();
  return () => {
    active = false;
    clearPreview();
  };
}
