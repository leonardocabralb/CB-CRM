// ============================================================
// A busca de contato que roda NO BANCO — o filtro `.or()` de um termo
// digitado, montado em um lugar só.
//
// ⚠️⚠️ Existe porque os dois seletores de cliente (o do negócio e o da
// tarefa) carregavam `contacts` INTEIRO para filtrar no navegador, e o
// PostgREST corta em 1000 linhas sem avisar: `error: null`, mil linhas e
// cara de lista completa. Com os ~12.980 contatos que a carga da Kommo
// traz (hoje são 1.212), o cliente do meio do alfabeto em diante
// simplesmente NÃO APARECIA no seletor — sem erro, sem "carregar mais",
// sem nada na tela. O operador lê isso como "o cliente não está no CRM" e
// cadastra de novo, que é a ficha duplicada que a carga passou semanas
// evitando. O comentário do próprio `task-form` já mandava consertar isso
// quando a base passasse de mil.
//
// Irmão de `filtrarContatos` (o mesmo recorte, feito em JS sobre uma lista
// já carregada). O seletor da agenda tinha um `.or()` escrito à mão, e desde
// a Fase 11.4 usa este também (sem ele, não achava a ficha sem telefone
// pelo @ e comparava o telefone pelo texto cru). Aqui as duas regras
// difíceis ficam testáveis: o ESCAPE do termo e as grafias do NONO DÍGITO.
//
// ⚠️ O termo vai LITERAL, por `ramoContem` (`src/lib/postgrest/literal.ts`):
// `imatch` com o texto escapado, entre as aspas do PostgREST. Até
// 26/09/2026 era `ilike` com o escape do LIKE, e o PostgREST troca TODO `*`
// de um padrão like/ilike por `%`: buscar "L*K*A" (um cliente real) trazia 37
// fichas. Vírgula e parêntese continuam viajando inteiros dentro das aspas.
//
// ⚠️ Uma diferença ASSUMIDA em relação ao `filtrarContatos`: o `imatch` do
// Postgres é indiferente à CAIXA, não ao ACENTO. Buscar "jose" não acha
// "José" — o `unaccent` da casa vive no índice de `messages` (929), e
// `contacts` não tem nada equivalente. É o mesmo comportamento da busca da
// página de Contatos e do seletor da agenda; unificar isso é migration, não
// carona daqui.
// ============================================================

import { ramoContem } from '@/lib/postgrest/literal';

/**
 * Abaixo disto não se consulta. Com 12.980 contatos, uma letra devolve o
 * teto de resultados em ordem arbitrária — o operador leria os 20 primeiros
 * como "os que existem".
 */
export const MIN_TERMO_DE_BUSCA = 2;

/**
 * Quantas linhas o seletor pede. O teto existe para a lista caber na tela;
 * quem chega nele precisa DIZER que chegou (ver `contactSearchMore`), senão
 * o corte silencioso volta, só que em 20 em vez de 1000.
 */
export const TETO_DE_RESULTADOS = 20;

/**
 * As grafias do que foi DIGITADO que podem estar gravadas em
 * `contacts.phone` — a que veio e a irmã com/sem o NONO DÍGITO.
 *
 * ⚠️ É o espelho de `variantesDoNonoDigito`, virado do avesso, e a inversão
 * é obrigatória: lá as variantes são geradas sobre o número do CONTATO, o
 * que só funciona com a lista na mão. Aqui quem filtra é o banco, e não há
 * como transformar a coluna dentro de um `ilike` — então quem ganha as
 * variantes é o TERMO. Sem isso, digitar o número com o 9 deixa de achar a
 * ficha gravada sem ele, e a leitura do operador volta a ser "o cliente não
 * está no CRM" (o defeito que a busca da caixa de entrada consertou em
 * 09/09/2026).
 *
 * ⚠️ A âncora é o FIM do número, nunca o começo, e é o que faz uma regra só
 * cobrir os seis jeitos de digitar. Os 8 últimos dígitos são a parte
 * estável: o DDI e o DDD é que o operador inclui ou não. Ancorada no
 * começo, cada comprimento precisaria do seu caso, e o fragmento sem DDI
 * (o mais comum) não teria nenhum.
 *
 *  "5583980000016" (DDI+DDD+9) → tira o 9 → "558380000016"
 *  "558380000016"  (DDI+DDD)   → põe  o 9 → "5583980000016"
 *  "83980000016"   (DDD+9)     → tira o 9 → "8380000016"
 *  "8380000016"    (DDD)       → põe  o 9 → "83980000016"
 *  "980000016"     (local+9)   → tira o 9 → "80000016"
 *  "80000016"      (local)     → põe  o 9 → "980000016"
 *
 * ⚠️ Só CELULAR, como em `variantesDoNonoDigito`: o 9 foi acrescentado aos
 * móveis, que começam em 6–9. Um fixo ("551133334444") não ganha irmã —
 * inserir o 9 ali fabricaria um número que não existe.
 *
 * ⚠️ Limite escrito: fragmento que termina no MEIO do número ("3980000",
 * colado de um cadastro) sai sozinho, e aí só acha a grafia como está
 * gravada. O filtro em JS cobria esse caso; cobri-lo aqui pediria uma
 * variante por posição de 9, e o `.or()` cresceria a cada uma. Quem digita
 * o telefone digita do fim para trás, que é o que a régua acima cobre.
 */
export function variantesDoTermoTelefonico(digitos: string): string[] {
  if (!digitos) return [];

  const local = digitos.length - 8;
  const ehMovel = (pos: number) => /[6-9]/.test(digitos[pos] ?? '');

  // Tem o 9 logo antes dos 8 finais → a irmã é sem ele.
  if (digitos.length >= 9 && digitos[local - 1] === '9' && ehMovel(local)) {
    return [digitos, digitos.slice(0, local - 1) + digitos.slice(local)];
  }
  // Não tem → a irmã ganha o 9 naquela posição.
  if (digitos.length >= 8 && ehMovel(local)) {
    return [digitos, `${digitos.slice(0, local)}9${digitos.slice(local)}`];
  }
  return [digitos];
}

/**
 * Os ramos do `@`: ele conta como nome, como em `casaComContato`. A ficha que
 * só existe no Direct (989) ou que a Meta manda só com o nome de usuário do
 * WhatsApp (BSUID, Fase 11.4) não tem telefone nenhum, e é pelo @ que a
 * equipe a conhece. O @ digitado é descartado — as colunas guardam sem ele;
 * "@" sozinho não gera ramo (a agulha seria vazia e casaria todo mundo).
 */
function ramosDoArroba(limpo: string): string[] {
  const arroba = limpo.replace(/^@/, '').trim();
  return arroba
    ? [ramoContem('wa_username', arroba), ramoContem('instagram_username', arroba)]
    : [];
}

/**
 * Os ramos do telefone: os DÍGITOS do termo e a irmã do nono dígito.
 *
 * ⚠️⚠️ Telefone casa contra `phone_normalized`, NUNCA contra `phone`.
 * `phone` guarda o que o escritório DIGITOU — o formulário de contato
 * preserva a pontuação —, então "+55 (83) 98000-0016" não tem os dígitos
 * contíguos e um padrão de dígitos nunca casa com ele. A ficha continua no
 * banco e some da busca; se ela não tiver nome, fica inalcançável pelos
 * dois seletores. `phone_normalized` é coluna GERADA
 * (`regexp_replace(phone, '\D', '', 'g')`, migration 022), sempre só
 * dígitos, e é a mesma chave do índice único e do `upsertCsvContacts`.
 * Medido em 20/09/2026: 1 dos 1.214 contatos da produção já está assim.
 * (Achado do Codex no PR #231.)
 */
function ramosDoTelefone(limpo: string): string[] {
  return variantesDoTermoTelefonico(limpo.replace(/\D/g, '')).map((grafia) =>
    ramoContem('phone_normalized', grafia),
  );
}

/**
 * O valor do `.or()` para o termo digitado nos SELETORES de cliente (negócio,
 * tarefa, agenda), ou `null` quando ele é curto demais para valer uma
 * consulta.
 *
 * ⚠️ `null` é "não consulte", nunca "não achei": quem chama precisa manter
 * a diferença na tela, senão o seletor afirma "nenhum cliente" antes de a
 * primeira consulta sair — a armadilha da lista vazia virando afirmação,
 * que este repositório já pagou quatro vezes.
 *
 * Limite conhecido: os dígitos saem de QUALQUER termo, então "Maria 2" também
 * pede "telefone contém 2". A tela de Contatos não tem isso
 * (`ramosDaBuscaNaTabela`); aqui, trocar é decisão à parte.
 */
export function ramosDaBuscaDeContato(termo: string): string | null {
  const limpo = termo.trim();
  if (limpo.length < MIN_TERMO_DE_BUSCA) return null;
  return [ramoContem('name', limpo), ...ramosDoArroba(limpo), ...ramosDoTelefone(limpo)].join(
    ',',
  );
}

/**
 * O termo tem CARA de telefone: só dígitos, espaço e a pontuação de quem
 * digita um número (`+ ( ) - .`), com pelo menos um dígito.
 *
 * ⚠️ É o que separa "(83) 98000-0016" de "joao123@gmail.com" ou "Maria 2":
 * metade dos e-mails da produção tem dígito (985 de 2.013 em 17/11/2026), e
 * sem esta régua buscar um deles traria também toda ficha cujo telefone
 * contém aqueles dígitos.
 *
 * ⚠️ O número COLADO do WhatsApp vem com marcas de direção invisíveis em
 * volta (U+202A…U+202C) e editores trocam o hífen por traço tipográfico: a
 * mesma limpeza de `telefoneDigitado` vem antes da régua, senão o número
 * colado não era telefone e a tela dizia "nenhum contato".
 */
export function temCaraDeTelefone(termo: string): boolean {
  const limpo = termo
    .replace(/\p{Cf}/gu, '')
    .replace(/[‐-―−]/g, '-')
    .trim();
  return /\d/.test(limpo) && /^[\d\s+().-]+$/.test(limpo);
}

/**
 * O valor do `.or()` da TABELA de Contatos (`/contacts`, sem filtro de
 * etiqueta), ou `null` sem termo. Porte do #679 do original, com as nossas
 * peças: nome, e-mail, os dois `@` e — só quando o termo tem cara de
 * telefone — os dígitos em `phone_normalized` com a irmã do nono dígito.
 * "(83) 98000-0016" acha "+5583980000016".
 *
 * ⚠️ Sem o piso dos seletores: a tabela pagina com contagem exata, e uma letra
 * sempre filtrou ali.
 */
export function ramosDaBuscaNaTabela(termo: string): string | null {
  const limpo = termo.trim();
  if (!limpo) return null;
  return [
    ramoContem('name', limpo),
    ramoContem('email', limpo),
    ...ramosDoArroba(limpo),
    ...(temCaraDeTelefone(limpo) ? ramosDoTelefone(limpo) : []),
  ].join(',');
}
