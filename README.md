# ReservaLab

O ReservaLab é um protótipo funcional para organizar as reservas dos três laboratórios do IFCE, campus Boa Viagem. A ideia é que o professor consulte a agenda antes de planejar uma aula prática.

[Site de demonstração](https://reservalab-ifce-bv.vercel.app/) · [Telas e protótipo no Figma](https://www.figma.com/design/H3irZVhZBTx4tlFAi6vWiq)

## O que já dá para testar

Ao abrir o site, escolha um perfil fictício. Como docente, você pode consultar a agenda, reservar um horário e depois remarcar ou cancelar. No perfil, dá para editar o nome e adicionar, trocar ou remover a foto. A coordenação acompanha as reservas dos três laboratórios e adiciona docentes para a apresentação.

A aba de reservas agrupa os horários por dia e permite filtrar por laboratório e data. A agenda mostra os dias úteis dos próximos 15 dias corridos. Um horário ocupado não pode receber outra reserva no mesmo laboratório, e o mesmo docente não pode estar em dois laboratórios ao mesmo tempo. A coordenação pode substituir uma reserva mediante confirmação. Os dados de teste ficam no navegador em que foram criados.

## Tecnologias

- **HTML, CSS e JavaScript** na interface, com layout para computador e celular.
- **LocalStorage** para os dados da demonstração e **SessionStorage** para manter o perfil selecionado na aba.
- **Node.js e Vercel Functions** na API de acesso restrito. A coordenação emite um código, e o docente usa esse código para ativar a conta e definir a senha.
- **Vercel Blob** para o armazenamento privado das contas e fotos na área restrita.
- **Figma** para o desenho das telas e a navegação da apresentação.

Na Vercel, `dist/` é a pasta servida para quem abre o site. A API fica em `api/profile.mjs`, com as regras de acesso e foto em `server/profile-api.mjs`. O acesso institucional está desativado na demonstração. Para usar no campus, ainda é preciso configurar a conta inicial da coordenação e implementar um armazenamento compartilhado para as reservas.

## Rodar localmente

Com Node.js 20 ou superior, execute os comandos na pasta do projeto.

```bash
npm ci
npx http-server dist -p 4173
```

Abra [localhost:4173](http://localhost:4173) para testar a interface. Para executar os testes de reservas, perfis e permissões, use `npm test`. O comando `npm run check` verifica a sintaxe dos módulos.

## Alterações no código

A `main` guarda a versão estável. Para corrigir um problema ou desenvolver uma melhoria, abra uma branch a partir da `main`, como `filtro-de-reservas`. O GitHub confere a sintaxe e roda os testes no pull request antes de integrar a mudança.
