import('./app.mjs').catch(error => {
  console.error('ReservaLab startup', error);
  const main = document.querySelector('#main');
  if (!main) return;
  main.setAttribute('aria-busy', 'false');
  main.innerHTML = `<section class="empty-state" role="alert">
    <h1>Não foi possível carregar o ReservaLab</h1>
    <p>Verifique sua conexão e tente novamente.</p>
    <a class="button primary" href="./">Recarregar</a>
  </section>`;
});
