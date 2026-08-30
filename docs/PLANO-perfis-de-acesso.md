# Perfis de acesso — plano e estado da implementação

> Estado: **plano aprovado, nada implementado.** Decisões travadas com o
> operador em 2026-08-30. Atualizar este arquivo a cada fase concluída.

## O que é

Hoje o CRM tem **um eixo só** de permissão: a escada `owner > admin > agent >
viewer`, de onde saem 7 capacidades fixas (`src/lib/auth/roles.ts`). Isso responde
"o que a pessoa pode FAZER", mas não responde "sobre QUAL fatia do escritório" —
e é essa segunda pergunta que separa a equipe do trabalhista da equipe do
bancário.

Este plano acrescenta o segundo eixo na forma de **perfis de acesso**: uma
entidade que embute papel + telas visíveis + conexões + funis. Cadastrar alguém
passa a ser um campo só ("João → Advogado Trabalhista").

| Perfil | Papel base | Enxerga |
| --- | --- | --- |
| **Dono** | `owner` | tudo, sempre — não editável |
| **Administrador** | `admin` | tudo, todas as áreas |
| **Advogado \<Área\>** | `agent` | conexões + funis daquela área |
| **Observador** | `viewer` | o que for marcado, só leitura |

## ⚠️ Decisão de escopo: isto é restrição de VISUALIZAÇÃO, não de segurança

**Decidido pelo operador em 2026-08-30, com o trade-off na mesa.** Não haverá RLS
nova. As policies de `SELECT` continuam respondendo apenas "é membro desta
conta?" — o que significa que **um `agent` do trabalhista continua conseguindo
ler as conversas do bancário pela aba Network**, ou por uma chamada direta ao
PostgREST.

Isso é aceito porque o app é interno, usado só por funcionários do escritório, e
o objetivo declarado é **organizar o que cada um vê e mexe**, não conter um
adversário. Registrado aqui para que ninguém "conserte" isso depois achando que
foi esquecimento, e para que ninguém escreva no futuro que o recorte por área é
uma barreira de segurança — ele não é.

O que **continua** sendo barreira de verdade (guarda de servidor já existente,
intocada por este plano):

| Operação | Guarda |
| --- | --- |
| Conexões: criar / editar / excluir | `requireRole('admin')` |
| Membros: convidar / remover / mudar papel | `requireRole('admin')` |
| Apagar conta · transferir posse | `owner` |
| Escrita em geral (`viewer` não escreve) | RLS `_modify` (71 das 120 policies) |

## Modelo de dados

### Tabela nova: `cb_perfis_de_acesso`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | FK `accounts`, CASCADE |
| `nome` | text NOT NULL | "Advogado Trabalhista" |
| `papel_base` | `account_role_enum` NOT NULL | de onde vem a capacidade real |
| `telas` | text[] NOT NULL | ids de tela visíveis (lista fechada) |
| `secoes_config` | text[] NOT NULL | ids de seção de Configurações visíveis |
| `channel_ids` | uuid[] NOT NULL DEFAULT '{}' | **vazio = todas** |
| `pipeline_ids` | uuid[] NOT NULL DEFAULT '{}' | **vazio = todos** |
| `sistema` | boolean NOT NULL DEFAULT false | Dono/Administrador: não editável, não apagável |

- `UNIQUE (account_id, nome)` — dois "Advogado Trabalhista" na mesma conta é
  sempre erro de digitação, nunca intenção.
- `papel_base` **não pode ser `owner`** em perfil criado à mão (mesmo CHECK que
  `account_invitations.role` já usa).
- Arrays em vez de tabelas de vínculo: o dado é pequeno, sempre lido inteiro e
  nunca consultado ao contrário ("quais perfis usam este funil?" é varredura
  trivial numa conta com <20 perfis). Tabela de vínculo aqui seria três joins
  para nada.

### Coluna nova: `profiles.perfil_id`

`uuid NULL REFERENCES cb_perfis_de_acesso(id) ON DELETE SET NULL`.

⚠️ **`NULL` significa "sem restrição", não "sem acesso".** É o que preserva o
comportamento de hoje para todo mundo que já está na conta, e o que impede que
apagar um perfil tranque as pessoas dele para fora. A migration não precisa
preencher nada.

⚠️ **`account_role` continua sendo a fonte da verdade do que a pessoa PODE
fazer.** O perfil não substitui o papel — ele acrescenta telas e escopo. Ao
atribuir um perfil a alguém, a rota grava também o `account_role = papel_base`,
para que as guardas de servidor e a RLS continuem valendo sem conhecer perfis.
Se as duas colunas divergirem, **quem manda é `account_role`**.

### FKs compostas

`channel_ids` e `pipeline_ids` são arrays, então não têm FK. A consequência é
id órfão quando uma conexão ou funil é apagado. Tratamento: a leitura resolve
contra a lista viva e **ignora** id que não existe mais (mesma regra que
`descrever-passo.ts` já usa para tag apagada). Não há limpeza automática — id
órfão é inofensivo e some sozinho na próxima edição do perfil.

## Módulo puro: `src/lib/perfis/`

Toda a decisão mora aqui, testável sem banco e sem React — mesma forma de
`src/lib/tasks/permissoes.ts`, que já resolve isso para tarefas.

| Arquivo | Responde |
| --- | --- |
| `telas.ts` | catálogo fechado das telas e seções (ids + rota + rótulo i18n) |
| `visibilidade.ts` | `podeVerTela(perfil, telaId)`, `podeVerSecao(perfil, secaoId)` |
| `escopo.ts` | `canaisVisiveis(perfil, todos)`, `funisVisiveis(perfil, todos)`, `conversaNoEscopo(conversa, perfil)` |
| `padroes.ts` | os perfis de fábrica (Dono, Administrador, Observador, um Advogado de exemplo) |

⚠️ **A regra tem de existir num lugar só.** A rota decide com a mesma função que
desabilita o botão na tela — é a lição registrada no CLAUDE.md sobre
`permissoes.ts` das tarefas: regra reescrita em dois lugares diverge na primeira
mudança.

## ⚠️ Armadilhas conhecidas (todas já documentadas no CLAUDE.md)

Estas não são hipóteses — cada uma já mordeu neste repositório.

- ⚠️⚠️ **Conversa de grupo tem `conversations.channel_id` NULO, sempre.** Quem
  sabe o número é `cb_groups.channel_id`. Um filtro ingênuo por canal **apaga
  todos os grupos da caixa de entrada, em silêncio**. Usar `canalDaConversa()`
  de `src/lib/inbox/filtros.ts`, que já existe exatamente para isso.
- ⚠️ **Não filtrar por canal na CONSULTA do PostgREST.** Com o embed LEFT atual,
  `.eq('contact.algo', …)` filtra só o recurso embutido e as conversas que não
  casam continuam vindo com `contact: null`; trocar para `!inner` vira INNER JOIN
  e apaga toda conversa de grupo. Nenhum dos dois estoura e os dois passam em
  revisão. **Filtrar em JS**, enquanto a lista for carregada inteira.
- ⚠️ **Escopo vazio = TUDO**, alinhado a `channelInScope` e `findEntryFlow`. A
  tela precisa DIZER isso ("sem marcação = vê todas as conexões"), senão o
  operador lê "nenhuma".
- ⚠️ **Trava anti-auto-bloqueio.** O Dono enxerga tudo sempre (curto-circuito
  antes de qualquer consulta a perfil), e as seções `members` e `overview` não
  podem ser desmarcadas de um perfil `admin`. Sem isso, um clique errado tranca
  o operador para fora da única tela que desfaria o erro.
- ⚠️ **Item de menu escondido ≠ rota protegida.** Esconder no `sidebar.tsx` não
  impede digitar `/pipelines` na barra de endereço. Cada tela restrita precisa da
  guarda no próprio componente, com a mensagem amigável — não um 404.
- ⚠️ **`useCan` retorna `false` durante `profileLoading`.** O gate de perfil tem
  de seguir a mesma regra (fail-closed), senão o menu pisca itens proibidos por
  um instante a cada carga.

## Fases

Cada fase é um PR próprio, mergeável sozinho, sem quebrar a anterior.

### Fase 1 — Fundação (sem efeito visível)

- Migration `9NN_cb_perfis_de_acesso.sql`: tabela + coluna + RLS de leitura para
  membros da conta + escrita só `service_role` (a tela escreve pela rota, como
  `cb_tasks`). ⚠️ `REVOKE ALL ON TABLE ... FROM anon`, e todo `REVOKE` com o
  `GRANT` de volta — a migration precisa aplicar num banco VAZIO (regra do CI).
- `src/lib/perfis/` completo, com testes.
- Hook `usePerfil()` + o perfil entra no `useAuth`.
- **Nada muda na tela.** Todo mundo com `perfil_id NULL` continua vendo tudo.

### Fase 2 — Menu e rotas

- `sidebar.tsx` filtra itens por `podeVerTela`.
- Guarda em cada página restrita, com a tela amigável ("Esta área não faz parte
  do seu perfil — falar com o administrador"), nunca 404.
- Seções de Configurações filtradas por `podeVerSecao`.
- Sobe **automações e fluxos** de `agent` para `admin` nas 4 rotas
  (`/api/automations`, `/api/automations/[id]`, `/api/flows`, `/api/flows/[id]`)
  e confere se `/api/whatsapp/broadcast` já exige admin — hoje exige `agent`.

### Fase 3 — Escopo na caixa de entrada

- `filtros.ts` ganha o recorte por perfil, ao lado dos filtros que já existem —
  **com `canalDaConversa()`**, pela armadilha dos grupos.
- Busca e notificações: o item aparece **completo** (decisão do operador), e a
  mensagem amigável entra ao tentar **abrir** a conversa fora do escopo.
- Agendadas: recorte por área, mantendo as de todos os colegas.

### Fase 4 — Escopo nos funis

- `/pipelines` lista só os funis do perfil.
- Aba **Negócios** da ficha do contato esconde negócio de funil fora do escopo.
- ⚠️ Conferir o Painel: ele agrega a conta inteira. Para perfil restrito a tela
  já estará escondida (Fase 2), então não há número pela metade — confirmar que
  não sobrou nenhum widget de painel embutido em outra tela.

### Fase 5 — Tela de perfis (Configurações → Perfis de acesso)

- CRUD, com **Duplicar** (o antídoto para a multiplicação por área).
- Ao marcar conexões, **sugerir** os funis pelo `default_pipeline_id` de cada
  uma — sugestão, nunca imposição.
- Perfis `sistema` aparecem travados, com cadeado e explicação.

### Fase 6 — Legenda em Membros

- Resumo do perfil dentro do **diálogo de convite**, atualizando ao trocar a
  seleção ("vê Caixa de entrada e Funis do trabalhista; não vê Painel, Radar,
  Automações, Disparos nem Configurações da conta").
- Cada linha da lista de membros mostra o **perfil**, não o papel cru.
- Quadro comparativo dos perfis na própria aba — **derivado da configuração
  real**, nunca texto fixo no dicionário: legenda escrita à mão mente na
  primeira edição de perfil.

## Catálogo de telas (lista fechada)

`dashboard` · `radar` · `inbox` · `notifications` · `tarefas` · `contacts` ·
`agenda` · `pipelines` · `broadcasts` · `agendadas` · `automations` · `flows` ·
`agents` · `settings`

Seções de Configurações: `overview` · `profile` · `security` · `appearance` ·
`channels` · `templates` · `quick-replies` · `acervo` · `fields` · `deals` ·
`assinatura` · `members` · `integracoes` · `api`

⚠️ Catálogo **fechado e exaustivo**: rota nova sem entrada aqui nasce invisível
para todo perfil restrito. Quem criar tela nova acrescenta o id — e o typecheck
cobra, porque `TelaId` é union de literais.

## Matriz de fábrica

Ponto de partida entregue pronto; tudo editável na Fase 5 (exceto o travado).

| Tela | Administrador | Advogado \<Área\> | Observador |
| --- | :---: | :---: | :---: |
| Painel · Radar | ✅ | ❌ | ❌ |
| Caixa de entrada | tudo | área | área (lê) |
| Funis | todos | área | área (lê) |
| Contatos | ✅ | ✅ (sem filtro) | lê |
| Notificações · Tarefas · Agenda | ✅ | ✅ | ✅ |
| Agendadas | ✅ | ✅ de todos, da área | ❌ |
| Disparos em massa | ✅ | ❌ | ❌ |
| Automações · Fluxos · Agentes de IA | ✅ | ❌ | ❌ |
| Configurações → pessoais | ✅ | ✅ | ✅ |
| Configurações → Respostas rápidas | edita | **usa** | **usa** |
| Configurações → conta | ✅ | ❌ | ❌ |

## Fora desta versão (decidido, não esquecido)

- **RLS por área.** Ver a seção de escopo acima — decisão do operador.
- **Filtro de Contatos por área.** Contato não tem conexão própria; derivar das
  conversas esconderia cliente compartilhado entre duas áreas. O conteúdo
  sensível está na conversa e no negócio, que já são recortados.
- **Herança entre perfis.** "Advogado Trabalhista herda de Advogado" resolveria
  a edição em massa, mas custa mais do que o botão Duplicar resolve com 2 a 5
  áreas. Revisitar se passar de ~10 perfis.
- **Escopo na API pública v1.** As chaves de API são de conta, não de pessoa;
  perfil não se aplica.
