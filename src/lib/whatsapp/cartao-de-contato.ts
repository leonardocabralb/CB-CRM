// ============================================================
// Cartão de contato (1060): o contato que alguém compartilha no WhatsApp.
//
// Até 28/09/2026 o CRM não conhecia esse tipo e gravava uma bolha VAZIA — o
// vCard chegava inteiro à Evolution e morria no normalizador. Medido: 24
// cartões perdidos em setembro, 23 deles de clientes (um cliente mandou duas
// vezes o contato da assessoria que o cobrava, porque a advogada pediu e não
// viu nada chegar).
//
// Puro e sem dependência de servidor: lido na ingestão (Evolution e Meta) e
// no navegador (a bolha lê `messages.contatos` por `lerContatosGravados`).
// ============================================================

/** Um telefone do cartão. */
export interface TelefoneDoCartao {
  /** Como o cartão o escreve ("+55 85 99999-9999"). */
  numero: string;
  /**
   * O id de WhatsApp daquele número (só dígitos, com DDI). Só vem quando o
   * número usa WhatsApp — e é por isso que o botão "Conversar" depende dele,
   * como no próprio WhatsApp (sem ele, lá aparece "Convidar").
   */
  waid: string | null;
}

/** Um contato do cartão (`messages.contatos` guarda uma lista destes). */
export interface ContatoCompartilhado {
  nome: string;
  empresa: string | null;
  telefones: TelefoneDoCartao[];
}

/**
 * Tetos contra payload fora do comum. O cartão vem de fora — um
 * `contactsArrayMessage` pode trazer a agenda inteira de alguém — e a linha
 * vai para a tela, para a busca e para o transcrito do Radar.
 */
export const MAX_CONTATOS = 50;
export const MAX_TELEFONES = 10;
const MAX_TEXTO = 200;

function aparar(texto: string | null | undefined, teto = MAX_TEXTO): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim().slice(0, teto);
}

function soDigitos(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const d = String(valor).replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Desfaz os escapes do vCard (`\,` `\;` `\n` `\\`). */
function desescapar(valor: string): string {
  return valor.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c));
}

/**
 * Divide por `;` que NÃO esteja escapado — o separador dos campos de N e ORG.
 *
 * ⚠️ Laço, e não `split(/(?<!\\);/)`: este módulo também é carregado no
 * navegador, e o Safari só entende lookbehind a partir do iOS 16.4 — num
 * iPhone mais antigo o regex derrubaria o arquivo inteiro na carga, e a bolha
 * junto.
 */
function partes(valor: string): string[] {
  const saida: string[] = [];
  let atual = '';
  for (let i = 0; i < valor.length; i++) {
    const c = valor[i];
    if (c === '\\' && i + 1 < valor.length) {
      atual += c + valor[i + 1];
      i++;
    } else if (c === ';') {
      saida.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  saida.push(atual);
  return saida.map((p) => aparar(desescapar(p)));
}

/**
 * Lê um vCard (3.0, o que o WhatsApp gera). Só o que a bolha mostra: nome,
 * empresa e telefones. `PHOTO` (base64 de vários KB) é ignorada de propósito.
 *
 * Formas medidas nos cartões reais de setembro:
 *   `FN:Gomes Group` · `ORG:Gomes Group;` · `X-WA-BIZ-NAME:…`
 *   `TEL;type=CELL;type=VOICE;waid=5585…:+55 85 9…` · `item1.TEL;waid=…:…`
 *
 * `nomeExibido` é o `displayName` do WhatsApp, que vale quando o vCard não
 * traz nome (há cartões com `N:;;;;` e `FN` vazio). Devolve null quando não há
 * nome nem telefone — um cartão sem nada não vira linha na bolha.
 */
export function lerVcard(
  vcard: string | null | undefined,
  nomeExibido?: string | null,
): ContatoCompartilhado | null {
  // Linha dobrada (RFC 6350): quebra seguida de espaço ou tab continua a de cima.
  const linhas = (vcard ?? '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);

  let fn = '';
  let nomeEstruturado = '';
  let org = '';
  let negocio = '';
  const telefones: TelefoneDoCartao[] = [];

  for (const linha of linhas) {
    const i = linha.indexOf(':');
    if (i <= 0) continue;
    const [nomeComGrupo, ...parametros] = linha.slice(0, i).split(';');
    // `item1.TEL` → `TEL`: o grupo só amarra o telefone ao rótulo dele.
    const propriedade = nomeComGrupo.slice(nomeComGrupo.lastIndexOf('.') + 1).toUpperCase();
    const valor = linha.slice(i + 1);

    if (propriedade === 'FN') {
      fn = aparar(desescapar(valor));
    } else if (propriedade === 'N') {
      // Sobrenome;Nome;Do meio;Prefixo;Sufixo → "Prefixo Nome Do meio Sobrenome Sufixo"
      const [sobrenome = '', nome = '', meio = '', prefixo = '', sufixo = ''] = partes(valor);
      nomeEstruturado = aparar([prefixo, nome, meio, sobrenome, sufixo].filter(Boolean).join(' '));
    } else if (propriedade === 'ORG') {
      org = partes(valor)[0] ?? '';
    } else if (propriedade === 'X-WA-BIZ-NAME') {
      negocio = aparar(desescapar(valor));
    } else if (propriedade === 'TEL' && telefones.length < MAX_TELEFONES) {
      const waidParam = parametros.find((p) => /^waid=/i.test(p.trim()));
      const waid = soDigitos(waidParam?.trim().slice(5));
      // `tel:` é a forma de URI do vCard 4 (`TEL;VALUE=uri:tel:+55…`).
      const numero = aparar(desescapar(valor).replace(/^tel:/i, ''), 40) || (waid ? `+${waid}` : '');
      if (!numero) continue;
      const repetido = telefones.some(
        (t) => (waid && t.waid === waid) || t.numero.replace(/\D/g, '') === numero.replace(/\D/g, ''),
      );
      if (!repetido) telefones.push({ numero, waid });
    }
  }

  const nome = fn || nomeEstruturado || aparar(nomeExibido) || negocio;
  if (!nome && telefones.length === 0) return null;
  // Empresa só quando diz algo além do nome: no cartão de empresa do WhatsApp
  // Business, FN, ORG e X-WA-BIZ-NAME repetem o mesmo texto.
  const empresaBruta = org || negocio;
  const empresa =
    empresaBruta && empresaBruta.toLocaleLowerCase() !== nome.toLocaleLowerCase() ? empresaBruta : null;
  return { nome, empresa, telefones };
}

/**
 * Os `contacts` da Cloud API da Meta (`type: "contacts"`): a Meta já entrega o
 * cartão aberto — `name.formatted_name`, `org.company`, `phones[].phone` e
 * `phones[].wa_id` —, sem vCard.
 */
export function contatosDaMeta(contacts: unknown): ContatoCompartilhado[] {
  if (!Array.isArray(contacts)) return [];
  const saida: ContatoCompartilhado[] = [];
  for (const bruto of contacts.slice(0, MAX_CONTATOS)) {
    if (!bruto || typeof bruto !== 'object') continue;
    const c = bruto as {
      name?: { formatted_name?: unknown; first_name?: unknown; last_name?: unknown };
      org?: { company?: unknown };
      phones?: unknown;
    };
    const texto = (v: unknown) => (typeof v === 'string' ? v : '');
    const telefones: TelefoneDoCartao[] = [];
    if (Array.isArray(c.phones)) {
      for (const p of c.phones.slice(0, MAX_TELEFONES)) {
        if (!p || typeof p !== 'object') continue;
        const tel = p as { phone?: unknown; wa_id?: unknown };
        const waid = soDigitos(tel.wa_id);
        const numero = aparar(texto(tel.phone), 40) || (waid ? `+${waid}` : '');
        if (numero) telefones.push({ numero, waid });
      }
    }
    const nome =
      aparar(texto(c.name?.formatted_name)) ||
      aparar([texto(c.name?.first_name), texto(c.name?.last_name)].filter(Boolean).join(' '));
    if (!nome && telefones.length === 0) continue;
    const empresaBruta = aparar(texto(c.org?.company));
    const empresa =
      empresaBruta && empresaBruta.toLocaleLowerCase() !== nome.toLocaleLowerCase() ? empresaBruta : null;
    saida.push({ nome, empresa, telefones });
  }
  return saida;
}

/**
 * O texto do cartão para `content_text`: uma linha por contato,
 * `👤 Nome · +55 85 9…`. É o que a prévia da lista, a busca (929), o
 * transcrito do Radar, o contexto do agente de IA e a API v1 enxergam — a
 * bolha desenha o cartão a partir de `contatos`, não daqui.
 *
 * O `👤` é o mesmo sinal que o WhatsApp põe na prévia do cartão, e não
 * depende de idioma (o texto é dado, não interface).
 */
export function resumoDosContatos(contatos: ContatoCompartilhado[]): string | null {
  const linhas = contatos.map((c) => {
    const numeros = c.telefones.map((t) => t.numero).join(', ');
    const nome = c.nome || numeros;
    return numeros && c.nome ? `👤 ${nome} · ${numeros}` : `👤 ${nome}`;
  });
  return linhas.length > 0 ? linhas.join('\n') : null;
}

/**
 * `messages.contatos` como veio do banco (jsonb). Lido campo a campo, nunca
 * com `as`: a coluna aceita qualquer JSON, e uma linha estranha não pode
 * derrubar a bolha nem desenhar "undefined".
 */
export function lerContatosGravados(valor: unknown): ContatoCompartilhado[] {
  if (!Array.isArray(valor)) return [];
  const saida: ContatoCompartilhado[] = [];
  for (const bruto of valor.slice(0, MAX_CONTATOS)) {
    if (!bruto || typeof bruto !== 'object') continue;
    const c = bruto as Record<string, unknown>;
    const nome = typeof c.nome === 'string' ? c.nome : '';
    const empresa = typeof c.empresa === 'string' && c.empresa ? c.empresa : null;
    const telefones: TelefoneDoCartao[] = [];
    if (Array.isArray(c.telefones)) {
      for (const t of c.telefones.slice(0, MAX_TELEFONES)) {
        if (!t || typeof t !== 'object') continue;
        const tel = t as Record<string, unknown>;
        if (typeof tel.numero !== 'string' || !tel.numero) continue;
        telefones.push({ numero: tel.numero, waid: soDigitos(tel.waid) });
      }
    }
    if (nome || telefones.length > 0) saida.push({ nome, empresa, telefones });
  }
  return saida;
}

/**
 * O número a levar para a "Nova conversa": `+` e o id de WhatsApp. Só com o
 * `waid` — número que não usa WhatsApp não tem com quem conversar.
 */
export function numeroParaConversar(telefone: TelefoneDoCartao): string | null {
  return telefone.waid ? `+${telefone.waid}` : null;
}
