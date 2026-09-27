// ============================================================
// O robô GRAVA a resposta do cliente na FICHA (CB, 26/09/2026).
//
// Pedido do operador para o robô do previdenciário: cada resposta da
// pré-qualificação vai para um campo do bloco "Previdenciário", e o nome que o
// lead digita vira o NOME do contato. Até aqui o robô guardava a resposta só
// em `flow_runs.vars`, que morre com o run — a ficha não sabia de nada.
//
// Três nós gravam: "Coletar resposta" (o texto digitado), "Enviar botões" e
// "Enviar lista" (o TÍTULO da opção tocada). A escolha mora em `salvar_em`,
// na mesma forma do passo `update_contact_field` das automações:
// `'name'` ou `'custom:<id do campo>'`.
//
// ⚠️ Regras, e todas vêm de lugares que já valem no projeto:
//   · NOME é gravado FIXADO (999) — sem a marca, a mensagem seguinte do
//     cliente trocaria o nome pelo do perfil do WhatsApp. O título do card
//     acompanha sozinho (gatilho da 1007). Mas aqui o valor é CONVERSA, não
//     campo de formulário: passa antes por `nomeDigitadoNoChat` ("Bom dia",
//     "👍" e frase não viram nome), e só grava onde NINGUÉM fixou o nome ainda
//     (`.is('nome_fixado_em', null)` no próprio UPDATE) — ver a função.
//   · VAZIO NÃO APAGA o que a ficha já sabe (a régua de 21/09 do
//     `update_contact_field`).
//   · Campo de DATA só recebe instante com fuso escrito (`instanteCanonico`):
//     o que o cliente digita ("12/03/2020") não é isso, e gravado cru deixaria
//     o campo ilegível para a tela e para o lembrete da 935. A tela nem
//     oferece campo de data; o motor recusa por segurança.
//   · Campo NÚMERO só recebe número — "uns três anos" não vai para lá, e
//     "1.000" é mil (o ponto de milhar à brasileira), não um.
//   · O campo "E-mail" ESPELHADO (1000) só recebe o que tem forma de e-mail:
//     o gatilho leva o valor a `contacts.email`, que liga tl;dv e Asaas.
//   · O campo tem de ser DA CONTA do run: o motor roda em service role e
//     ignora RLS.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { TIPO_DATA, instanteCanonico } from '@/lib/contacts/campo-data';
import { ESPELHO_DO_EMAIL } from '@/lib/contacts/email-espelhado';
import { nomeParaFixar } from '@/lib/contacts/nome-fixado';

export type DestinoDaResposta = { tipo: 'nome' } | { tipo: 'campo'; campoId: string };

/** Os nós que sabem gravar a resposta. */
export const NOS_QUE_GRAVAM = ['collect_input', 'send_buttons', 'send_list'] as const;

const PREFIXO_DO_CAMPO = 'custom:';

/**
 * Puro: o destino configurado no nó, ou `null` quando ele não grava nada.
 *
 * ⚠️ `'name'` só vale no `collect_input`: nos botões e na lista o valor é o
 * título de uma opção ("Fiquei encostado"), que não é nome de ninguém — e
 * gravado FIXADO, não sairia mais da ficha. O validador recusa a combinação;
 * aqui ela é ignorada, por segurança.
 */
export function destinoDaResposta(nodeType: string, salvarEm: unknown): DestinoDaResposta | null {
  if (!(NOS_QUE_GRAVAM as readonly string[]).includes(nodeType)) return null;
  if (typeof salvarEm !== 'string') return null;
  const valor = salvarEm.trim();
  if (valor === 'name') return nodeType === 'collect_input' ? { tipo: 'nome' } : null;
  if (valor.startsWith(PREFIXO_DO_CAMPO)) {
    const campoId = valor.slice(PREFIXO_DO_CAMPO.length).trim();
    return campoId ? { tipo: 'campo', campoId } : null;
  }
  return null;
}

/** Puro: a forma gravada em `salvar_em` para um destino. */
export function salvarEmDoDestino(destino: DestinoDaResposta): string {
  return destino.tipo === 'nome' ? 'name' : `${PREFIXO_DO_CAMPO}${destino.campoId}`;
}

/**
 * Puro: o TÍTULO configurado da opção tocada (botão ou linha da lista), cru —
 * quem chama aplica as variáveis do run, como no envio. `null` quando o
 * `reply_id` não é de nenhuma opção deste nó.
 */
export function tituloDaOpcao(
  nodeType: string,
  config: Record<string, unknown>,
  replyId: string,
): string | null {
  if (nodeType === 'send_buttons') {
    const botoes = Array.isArray(config.buttons)
      ? (config.buttons as Array<{ reply_id?: unknown; title?: unknown }>)
      : [];
    const achado = botoes.find((b) => b.reply_id === replyId);
    return typeof achado?.title === 'string' ? achado.title : null;
  }
  if (nodeType === 'send_list') {
    const secoes = Array.isArray(config.sections)
      ? (config.sections as Array<{ rows?: Array<{ reply_id?: unknown; title?: unknown }> }>)
      : [];
    for (const secao of secoes) {
      const achada = (secao.rows ?? []).find((r) => r.reply_id === replyId);
      if (achada) return typeof achada.title === 'string' ? achada.title : null;
    }
  }
  return null;
}

/** Tipos de campo que a TELA oferece ao robô. Data fica de fora (ver o topo). */
export const TIPOS_DE_CAMPO_DO_ROBO = ['text', 'select', 'number'] as const;

export function campoServeAoRobo(fieldType: string): boolean {
  return (TIPOS_DE_CAMPO_DO_ROBO as readonly string[]).includes(fieldType);
}

/**
 * Puro: o campo serve a ESTE nó? Filtra a lista da tela.
 *
 * ⚠️ Botões e lista gravam o TÍTULO da opção ("Fiquei encostado"): num campo
 * NÚMERO — ou no "E-mail" espelhado (1000) — ele cairia sempre na recusa do
 * motor e nada seria gravado, calado (só o log do run diria). Por isso esses
 * dois não são oferecidos ali. No "Coletar resposta" o campo de LISTA
 * continua oferecido (a tela avisa que o texto livre pode não bater com as
 * opções).
 */
export function campoServeAoNo(
  nodeType: string,
  campo: { field_type: string; espelho?: string | null },
): boolean {
  if (!campoServeAoRobo(campo.field_type)) return false;
  if (nodeType === 'send_buttons' || nodeType === 'send_list') {
    return campo.field_type !== 'number' && campo.espelho !== ESPELHO_DO_EMAIL;
  }
  return true;
}

// ------------------------------------------------------------
// NOME digitado no chat.
// ------------------------------------------------------------

/**
 * Palavras que, SOZINHAS, não são nome de ninguém: saudação, resposta curta e
 * o assunto do anúncio. Frase feita só delas ("Bom dia", "Oi tudo bem",
 * "Quero saber mais sobre auxílio acidente") não vira nome. Comparadas sem
 * acento e em minúsculas.
 */
const NAO_E_NOME = new Set([
  'oi', 'oii', 'oie', 'ola', 'alo', 'hello', 'hi', 'hey', 'opa', 'eai',
  'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'td', 'e', 'ai',
  'sim', 'nao', 'ok', 'okay', 'certo', 'claro', 'blz', 'beleza', 'obrigado',
  'obrigada', 'obg', 'pode', 'ser', 'quero', 'queria', 'gostaria', 'tenho',
  'interesse', 'saber', 'mais', 'sobre', 'informacao', 'informacoes', 'info',
  'o', 'a', 'de', 'do', 'da', 'teste', 'doutor', 'doutora', 'dr', 'dra',
  'auxilio', 'acidente', 'acidentado', 'acidentada', 'beneficio', 'inss',
]);

/** Saudação que pode ABRIR a resposta e sai antes do nome ("Bom dia, Maria"). */
const SAUDACAO = new Set([
  'oi', 'oii', 'oie', 'ola', 'alo', 'hello', 'hi', 'hey', 'opa', 'eai',
  'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'td', 'e', 'ai',
]);

/** Começos de frase que antecedem o nome ("Meu nome é Maria" → "Maria"). */
const PREFIXOS_DO_NOME: readonly string[][] = [
  ['o', 'meu', 'nome', 'e'],
  ['meu', 'nome', 'e'],
  ['eu', 'me', 'chamo'],
  ['me', 'chamo'],
  ['pode', 'me', 'chamar', 'de'],
  ['me', 'chama', 'de'],
  ['aqui', 'e', 'o'],
  ['aqui', 'e', 'a'],
  ['aqui', 'e'],
  ['eu', 'sou', 'o'],
  ['eu', 'sou', 'a'],
  ['eu', 'sou'],
  ['sou', 'o'],
  ['sou', 'a'],
  ['sou'],
];

/** Tetos de um nome digitado: acima disso é frase, não nome. */
const MAX_LETRAS_DO_NOME = 60;
const MAX_PALAVRAS_DO_NOME = 6;

function chaveDaPalavra(palavra: string): string {
  return palavra
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
}

/**
 * Puro: o NOME que o cliente digitou no chat, pronto para a ficha — ou `null`
 * quando a resposta não é um nome.
 *
 * ⚠️ `nomeParaFixar` sozinha não serve aqui: ela foi feita para fontes
 * ESTRUTURADAS (o campo de nome do Calendly, a variável de um formulário),
 * onde o único lixo realista é o telefone. No "Coletar resposta" o valor é
 * CONVERSA de lead de anúncio — "Bom dia", "👍", "sim", "Meu nome é João e
 * sofri acidente em 2019…" passariam todos, e o nome ficaria FIXADO assim (e o
 * card do Kanban, chamado "Bom dia"). A régua:
 *   · uma linha só, até 60 letras e 6 palavras;
 *   · emoji sai; o resto só pode ter letras, espaço, apóstrofo, hífen e ponto
 *     (dígito, vírgula no meio e outros símbolos = não é nome);
 *   · saudação no começo sai ("Bom dia, Maria" → "Maria"), e o começo de frase
 *     também ("Meu nome é Maria" / "Me chamo Maria" → "Maria");
 *   · o que sobra não pode ser só saudação ou assunto ("Quero saber mais").
 * Maiúsculas e minúsculas ficam como a pessoa escreveu (a régua da 999).
 */
export function nomeDigitadoNoChat(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null;
  const aparado = bruto.trim();
  if (!aparado || /[\r\n]/.test(aparado)) return null;

  // Emoji sai antes de tudo: "Maria 😊" é Maria, e "👍" sozinho não é nada.
  let palavras = aparado
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/, '')
    .split(' ')
    .filter(Boolean);

  // Saudação no começo ("Oi,", "Bom dia", "Boa tarde,") sai antes do nome.
  while (palavras.length > 0 && SAUDACAO.has(chaveDaPalavra(palavras[0]))) {
    palavras = palavras.slice(1);
  }
  // Começo de frase. A lista vem do mais longo para o mais curto de cada
  // família ("eu sou o" antes de "eu sou"), então o primeiro que casa vale.
  const chaves = palavras.map(chaveDaPalavra);
  for (const prefixo of PREFIXOS_DO_NOME) {
    if (prefixo.every((p, i) => chaves[i] === p)) {
      palavras = palavras.slice(prefixo.length);
      break;
    }
  }

  // A pontuação que sobrou colada nas pontas ("Maria," depois de "é:") sai.
  const nome = palavras.join(' ').replace(/^[.,;:'’-]+|[.!?,;:]+$/g, '').trim();
  if (!nome || nome.length > MAX_LETRAS_DO_NOME) return null;
  const finais = nome.split(' ');
  if (finais.length > MAX_PALAVRAS_DO_NOME) return null;
  if (!/^[\p{L}\p{M}' ’.\-]+$/u.test(nome) || !/\p{L}/u.test(nome)) return null;
  if (finais.every((p) => NAO_E_NOME.has(chaveDaPalavra(p)))) return null;
  return nomeParaFixar(nome);
}

// ------------------------------------------------------------
// Valor dos campos.
// ------------------------------------------------------------

const FORMA_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Puro: o número que a pessoa escreveu, como o banco guarda (ponto decimal),
 * ou `null`.
 *
 * ⚠️ "1.000" é MIL: o ponto seguido de exatamente três dígitos é o separador
 * de milhar brasileiro, e a regra antiga (`[.,]` como decimal) gravava "1.000"
 * — que o resto do sistema lê como um. Vírgula é sempre decimal ("2,5"); ponto
 * que não é milhar também ("2.5").
 */
export function numeroDigitado(bruto: string): string | null {
  const s = bruto.replace(/\s+/g, '');
  const milhar = s.match(/^(-?)(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/);
  if (milhar) return `${milhar[1]}${milhar[2].replace(/\./g, '')}${milhar[3] ? `.${milhar[3]}` : ''}`;
  const simples = s.match(/^(-?\d+)(?:[.,](\d+))?$/);
  if (simples) return `${simples[1]}${simples[2] ? `.${simples[2]}` : ''}`;
  return null;
}

/**
 * Puro: o valor que vai para o campo, conforme o TIPO dele — ou o motivo de
 * não gravar. O texto é aparado; nada além disso muda no texto e na lista.
 */
export function valorParaOCampo(
  fieldType: string,
  bruto: string,
  espelho?: string | null,
): { ok: true; valor: string } | { ok: false; motivo: string } {
  const valor = bruto.trim();
  if (!valor) return { ok: false, motivo: 'empty value' };
  if (fieldType === TIPO_DATA) {
    const instante = instanteCanonico(valor);
    return instante ? { ok: true, valor: instante } : { ok: false, motivo: 'not a date' };
  }
  if (fieldType === 'number') {
    const numero = numeroDigitado(valor);
    return numero === null ? { ok: false, motivo: 'not a number' } : { ok: true, valor: numero };
  }
  // O campo "E-mail" espelha `contacts.email` (1000): "não tenho" viraria o
  // e-mail da ficha, e é por ele que tl;dv e Asaas acham o cliente.
  if (espelho === ESPELHO_DO_EMAIL && !FORMA_DE_EMAIL.test(valor)) {
    return { ok: false, motivo: 'not an e-mail' };
  }
  return { ok: true, valor };
}

/**
 * I/O: grava a resposta no destino. Devolve se gravou e, quando não, o motivo
 * (em inglês, como o resto do log do robô). LANÇA em erro de banco — quem
 * chama registra e segue o fluxo: gravar na ficha é consequência, e o cliente
 * não pode ficar preso no meio do robô por causa dela (a mesma decisão do
 * `set_tag`).
 */
export async function gravarRespostaNaFicha(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; destino: DestinoDaResposta; valor: string },
): Promise<{ gravou: boolean; detalhe: string }> {
  const { accountId, contactId, destino, valor } = args;

  if (destino.tipo === 'nome') {
    const nome = nomeDigitadoNoChat(valor);
    if (!nome) return { gravou: false, detalhe: 'name not saved: the answer does not look like a name' };
    const agora = new Date().toISOString();
    // ⚠️⚠️ SÓ onde ninguém fixou o nome ainda — a condição mora no UPDATE,
    // nunca numa leitura antes. O robô é fonte deliberada FRACA (texto livre
    // do chat): o nome que gente escreveu, o do contrato do Asaas ou o do
    // agendamento do Calendly vencem, e o cliente antigo do escritório que
    // dispare o robô não tem o nome trocado pelo que digitar. É a única
    // escrita que RESPEITA e GRAVA a marca ao mesmo tempo (declarada em
    // `nome-fixado.chamadores.test.ts`). Decisão do operador (26/09/2026,
    // dúvida B12 do plano do previdenciário).
    //
    // ⚠️ O `select` conta as linhas: zero = já estava fixado (ou a ficha
    // sumiu no meio), e o log não pode dizer "name saved" sobre nada.
    const { data, error } = await db
      .from('contacts')
      .update({ name: nome, nome_fixado_em: agora, updated_at: agora })
      .eq('id', contactId)
      .eq('account_id', accountId)
      .is('nome_fixado_em', null)
      .select('id');
    if (error) throw new Error(`name update failed: ${error.message}`);
    if (!data || data.length === 0) {
      return { gravou: false, detalhe: 'name not saved: the contact name was already fixed — kept' };
    }
    return { gravou: true, detalhe: 'name saved' };
  }

  // Defesa em profundidade: o motor roda em service role, então confere que
  // o campo é DESTA conta antes de escrever.
  const { data: campo, error: erroCampo } = await db
    .from('custom_fields')
    .select('id, field_type, espelho')
    .eq('id', destino.campoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (erroCampo) throw new Error(`custom field lookup failed: ${erroCampo.message}`);
  if (!campo) return { gravou: false, detalhe: 'field not found (deleted?)' };

  const { field_type, espelho } = campo as { field_type: unknown; espelho?: unknown };
  const pronto = valorParaOCampo(
    String(field_type),
    valor,
    typeof espelho === 'string' ? espelho : null,
  );
  if (!pronto.ok) return { gravou: false, detalhe: `field not saved: ${pronto.motivo}` };

  // Upsert no UNIQUE(contact_id, custom_field_id) da 001 — o mesmo do passo
  // `update_contact_field`. O campo "E-mail" espelhado (1000) leva o valor
  // até `contacts.email` pelo gatilho do banco, sem nada a fazer aqui.
  const { error } = await db
    .from('contact_custom_values')
    .upsert(
      { contact_id: contactId, custom_field_id: destino.campoId, value: pronto.valor },
      { onConflict: 'contact_id,custom_field_id' },
    );
  if (error) throw new Error(`custom field write failed: ${error.message}`);
  return { gravou: true, detalhe: 'field saved' };
}
