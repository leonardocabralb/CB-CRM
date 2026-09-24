---
paths:
  - "src/lib/celular/teclado*"
  - "src/hooks/use-tela-acima-do-teclado*"
  - "src/hooks/use-media-query*"
  - "src/app/*/dashboard-shell.tsx"
  - "src/app/globals.css"
  - "src/app/manifest*"
  - "src/app/apple-icon.tsx"
  - "src/app/layout.tsx"
  - "src/lib/marca.ts"
  - "src/components/inbox/message-composer.tsx"
  - "src/components/inbox/message-thread.tsx"
  - "src/app/*/inbox/**"
  - "src/lib/inbox/voltar-no-celular*"
---

# Celular — regras

Vale ao mexer na altura da casca, no fio e no compositor em aparelho de toque, na navegação da caixa de entrada no celular e no app instalado (manifesto, ícone). O navegador do computador NÃO testa teclado nem gesto: a verificação é no aparelho, depois do deploy. Telas que recarregam ao voltar para o app: `.claude/rules/ao-voltar.md`. O compositor que quebra linha no celular: `.claude/rules/inbox-conversa.md`.

### O teclado do celular: a conversa fica ACIMA dele

`src/lib/celular/teclado.ts` (puro), `src/hooks/use-tela-acima-do-teclado.ts` (montado na casca), a regra dos 16 px no fim do `globals.css` e o `data-acima-do-teclado` na raiz do `message-thread.tsx`. Pinos em `teclado.test.ts`.

- ⚠️⚠️ **A altura da casca e da caixa de entrada sai de `var(--altura-visivel,100dvh)` — nunca `h-screen`/`100vh`.** `100vh` não encolhe com o teclado: o iPhone empurra a página inteira para cima e o cabeçalho (o cliente e o número por onde a resposta sai) vai junto. A casca DESCE com o empurrão (`relative top-[var(--deslocamento-visivel)]`, com `visualViewport.pageTop`); `window.scrollTo(0, 0)` só ao SAIR do ajuste. Tela nova de altura cheia usa a mesma variável. Um merge que devolva `h-screen` devolve o cabeçalho sumindo.
- ⚠️ **`pageTop`, NUNCA só `offsetTop`:** este é contado da janela e fica em zero quando o iPhone revela a caixa ROLANDO a janela — a casca ficaria acima da área visível. Pelo mesmo motivo o hook relê na rolagem da janela.
- ⚠️⚠️ **A regra NÃO compara a área visível com `window.innerHeight`:** no app instalado a janela encolhe junto com o teclado, e a versão com limiar não agia nunca. Num aparelho de toque, com o foco no fio, a casca mede SEMPRE a área visível. `top`, nunca `transform`, na casca: transform faria todo `fixed` de dentro se posicionar pela casca.
- ⚠️⚠️ **O ajuste só age com o foco DENTRO de `[data-acima-do-teclado]`** (hoje, só o fio). Fora dele — formulário, diálogo, painel do contato — o empurrão do iPhone é o que revela o campo, e desfazê-lo esconderia o campo em que a pessoa digita. Marcar outra área é decisão a testar no aparelho.
- ⚠️ **O hook lê no `requestAnimationFrame`:** no `focusout` o foco ainda não chegou ao próximo campo, e ler ali diria "saiu da conversa" numa troca de campo. Pinça de zoom (`visualViewport.scale` ≠ 1) não ajusta nem desfaz.
- ⚠️ **Encolher o fio pela base esconderia as últimas mensagens:** um `ResizeObserver` no contêiner mantém no fim quem estava colado no fim (a dependência é a CONVERSA: o contêiner só existe com conversa aberta).
- ⚠️⚠️ **Letra de 16 px em todo campo de aparelho de toque, numa regra FORA de camada no `globals.css`:** abaixo disso o iPhone amplia a tela ao tocar no campo e não desfaz. Movida para `@layer base`, perderia para o `text-sm` (`@layer utilities`) e o zoom voltaria sem erro. A consulta é `MIDIA_DE_TOQUE`, a mesma do código (há teste).
- **No toque, o retorno pula linha e só o botão envia** (`enterEnvia`, decisão do operador): o teclado do celular não tem Shift+Enter. A dica troca para `typeMessagePlaceholderTouch`, via `useMediaQuery(MIDIA_DE_TOQUE)`.
- **Arrastar a conversa para BAIXO recolhe o teclado** (`arrastoRecolheTeclado`, o gesto do WhatsApp); para cima não — é quem continua escrevendo. Mora no `onTouchMove` do contêiner, junto do `liberarSalto`.

### Voltar da conversa pelo HISTÓRICO, no celular

`src/lib/inbox/voltar-no-celular.ts` (puro, com teste) e a página do inbox. O gesto da borda do iPhone e o botão voltar do Android andam no HISTÓRICO.

- ⚠️⚠️ **No celular (`!ehDesktop`), abrir conversa pela lista OU pelo "nova conversa" é `router.push` (`navegacaoAoAbrir`); no computador continua `replace`.** Com `replace` não havia passo, e o gesto SAÍA da caixa de entrada em vez de fechar a conversa. No computador, lista e conversa convivem, e um passo por clique faria o voltar percorrer o dia inteiro. Um merge que traga o `replace` cru do upstream devolve o defeito.
- ⚠️ **Não é arrasto feito à mão em JavaScript:** ele disputaria a borda com o gesto do sistema. É dar ao sistema o passo que o gesto desfaz.
- ⚠️⚠️ **Quem fecha a conversa no gesto é um ouvinte de `popstate`** (`aoAndarNoHistorico`): URL sem `?c=` com conversa na tela, fecha; URL com outra conversa, reabre pelo caminho do deep link. Num ouvinte, e não num efeito sobre `deepLinkConvId`: `setState` síncrono no corpo de efeito é erro do React Compiler, e `replace` não dispara `popstate`.
- ⚠️ **O botão voltar da tela DESFAZ o passo (`router.back()`) quando a abertura o criou (`abriuComPassoRef`):** com `replace`, sobrariam duas entradas da lista e o gesto seguinte "não faria nada". Recarregar a página zera a ref, e o botão volta ao `replace`.
- **`limparConversaAberta` é o que botão e `popstate` têm em comum, e não mexe na URL;** rodar duas vezes é inofensivo.

### App instalado no celular: o manifesto existe por causa do ESCOPO

`src/app/manifest.ts`, `src/app/apple-icon.tsx`, `NOME_CURTO_DO_APP` e `TAMANHOS_DO_ICONE` em `src/lib/marca.ts`. Pino: `src/app/manifest.test.ts`.

- ⚠️⚠️ **`scope: "/"` não é detalhe:** sem ele o iPhone decide sozinho quais endereços são do app, e abrir uma conversa (`/inbox?c=…`) cobria a tela com a moldura de navegador. Estreitar o escopo devolve a moldura. `id: "/"` fixo: trocar a tela de abertura não faz o Android tratar o app como outro.
- ⚠️ **O iPhone lê manifesto e ícone NA INSTALAÇÃO:** mudança de nome, ícone, escopo ou tela de abertura só chega a quem apagar o ícone e instalar de novo (com login de novo). Avisar o operador a cada mudança aqui.
- ⚠️ **O ícone é fundo até a borda, sem canto arredondado e sem transparência** (`apple-icon.tsx`): o iPhone arredonda sozinho e pinta transparência de preto. Não reaproveitar o `icon.tsx` da aba do navegador.
- ⚠️ **`TAMANHOS_DO_ICONE` alimenta os DOIS lados** (os arquivos do `apple-icon`, em `/apple-icon/<lado>`, e os `src` do manifesto): tamanho que só um lado conhece vira ícone quebrado, sem erro.
- ⚠️⚠️ **`metadata.icons` no `layout.tsx` DESLIGA os ícones de arquivo:** o Next só injeta `icon.tsx`/`apple-icon.tsx` quando o metadata não declara `icons`, e o `<head>` sairia sem `apple-touch-icon`. O upstream declara; foi removido. Um merge que o traga de volta tira o ícone do app sem conflito — o pino reprova.
- **O nome embaixo do ícone é `NOME_CURTO_DO_APP`** (build-arg `NEXT_PUBLIC_APP_SHORT_NAME`, no `appleWebApp` do layout); sem ele vale o `NOME_DO_APP`, que o iPhone corta. Marca nunca vem de literal (regra da raiz).
- **Abre em `/inbox`** (decisão do operador: no celular o uso é atender). Quem abre deslogado passa pelo login e cai no Painel.
- **Link recebido no WhatsApp abre no Safari, não no app instalado:** o iPhone não deixa link abrir app da Tela de Início. Não tem conserto do nosso lado.
