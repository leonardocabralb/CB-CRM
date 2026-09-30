/**
 * O catálogo das variáveis que o botão "Inserir campo" do construtor oferece,
 * e a leitura de um código já escrito no texto (a etiqueta).
 *
 * ⚠️⚠️ ESPELHO de `valorDaVariavel` (`engine.ts`). O motor decide o valor de
 * um código só pelos DOIS primeiros pedaços (`ns.prop`), e devolve vazio para
 * todo o resto; `classificarCodigo` repete essa régua para a etiqueta dizer a
 * verdade: o que o motor substitui aparece com nome, o que ele deixa em branco
 * aparece âmbar. Há teste cruzando os dois (`engine.test.ts`). Variável nova no
 * motor entra aqui, senão ela funciona mas não aparece no botão.
 *
 * Puro, sem React nem i18n: os nomes e as legendas moram nos dicionários, em
 * `Automations.variaveis.*`, pela `chave` de cada item (chave MONTADA — o
 * teste `catalogo.test.ts` lê os dois dicionários).
 */

export type GrupoFixo = 'contato' | 'negocio' | 'conversa' | 'data' | 'mensagem';

export interface VariavelFixa {
  /** O que vai entre as chaves: `contact.name`. */
  codigo: string;
  /** A chave nos dicionários: `Automations.variaveis.fixas.<chave>`. */
  chave: string;
  grupo: GrupoFixo;
  /**
   * O valor vem do EVENTO que disparou (a mensagem, a conexão), não da ficha:
   * a prévia de um cliente escolhido não o conhece.
   */
  doEvento?: true;
}

export const VARIAVEIS_FIXAS: readonly VariavelFixa[] = [
  { codigo: 'contact.name', chave: 'contact_name', grupo: 'contato' },
  { codigo: 'contact.phone', chave: 'contact_phone', grupo: 'contato' },
  { codigo: 'contact.email', chave: 'contact_email', grupo: 'contato' },
  { codigo: 'contact.company', chave: 'contact_company', grupo: 'contato' },
  { codigo: 'contact.origem', chave: 'contact_origem', grupo: 'contato' },
  { codigo: 'contact.link', chave: 'contact_link', grupo: 'contato' },
  { codigo: 'deal.value', chave: 'deal_value', grupo: 'negocio' },
  { codigo: 'deal.created_at', chave: 'deal_created_at', grupo: 'negocio' },
  { codigo: 'conversation.link', chave: 'conversation_link', grupo: 'conversa' },
  { codigo: 'channel.id', chave: 'channel_id', grupo: 'conversa', doEvento: true },
  { codigo: 'now', chave: 'now', grupo: 'data' },
  { codigo: 'message.text', chave: 'message_text', grupo: 'mensagem', doEvento: true },
];

/** Os códigos que a prévia calcula no servidor para o cliente escolhido. */
export const CODIGOS_DO_CLIENTE: readonly string[] = VARIAVEIS_FIXAS.filter((v) => !v.doEvento).map(
  (v) => v.codigo,
);

export const PREFIXO_DO_CAMPO = 'contact.campo.';
export const PREFIXO_DO_EVENTO = 'vars.';

/** As famílias de gatilho que entregam `{{vars.*}}` ao motor. */
export type FamiliaDoEvento = 'asaas' | 'calendly' | 'zapsign' | 'atlas' | 'webhook';

export function familiaDoEvento(tipoDoGatilho: string): FamiliaDoEvento | null {
  switch (tipoDoGatilho) {
    case 'asaas_cobranca_vencida':
    case 'asaas_cobranca_vence_hoje':
      return 'asaas';
    case 'calendly_booking':
      return 'calendly';
    case 'zapsign_documento_assinado':
      return 'zapsign';
    case 'atlas_situacao_mudou':
      return 'atlas';
    case 'webhook_received':
      return 'webhook';
    default:
      return null;
  }
}

/**
 * Os gatilhos que põem `message_text` no contexto: só a ingestão de mensagem
 * o faz (o webhook da Meta e `inbound-store.ts`, com o texto da mensagem em
 * TODOS os tipos que despacham — "Novo contato criado" inclusive, que só nasce
 * ali; Codex, #348). Fora deles, `{{message.text}}` sai em branco (menos por
 * encadeamento), e o botão não o oferece.
 */
export function gatilhoDeMensagem(tipoDoGatilho: string): boolean {
  return (
    tipoDoGatilho === 'new_message_received' ||
    tipoDoGatilho === 'new_contact_created' ||
    tipoDoGatilho === 'first_inbound_message' ||
    tipoDoGatilho === 'keyword_match' ||
    tipoDoGatilho === 'interactive_reply'
  );
}

/**
 * Gatilhos cujo EVENTO traz o card (`context.deal_id`): o motor usa aquele
 * card em `{{deal.*}}`, e a prévia, sem evento, usa o de `negocioAlvo` (o
 * aberto mais recente, senão o perdido, senão o ganho). Com mais de um card
 * no cliente, a prévia pode estar mostrando outro — a tela avisa (Codex, #348).
 */
export function gatilhoTrazCard(tipoDoGatilho: string): boolean {
  return (
    tipoDoGatilho === 'deal_stage_changed' ||
    tipoDoGatilho === 'deal_status_changed' ||
    tipoDoGatilho === 'zapsign_documento_assinado' ||
    // A mudança de situação do Atlas (1073) leva SEMPRE o card do evento.
    tipoDoGatilho === 'atlas_situacao_mudou'
  );
}

export type ClasseDoCodigo =
  | { tipo: 'fixa'; variavel: VariavelFixa }
  /** `contact.campo.<chave>` — a `field_key` do catálogo de campos. */
  | { tipo: 'campo'; chave: string }
  /** `vars.<nome>` — o que o evento do gatilho entrega. */
  | { tipo: 'evento'; nome: string }
  /** O motor devolve VAZIO para este código, sempre. */
  | { tipo: 'vazio' };

const FIXA_POR_CODIGO = new Map(VARIAVEIS_FIXAS.map((v) => [v.codigo, v]));

/**
 * O que o motor faz com o código — a régua de `valorDaVariavel`, pedaço por
 * pedaço: `contact.name.x` sai como o nome (o motor só olha `ns.prop`), e
 * `vars.a.b` como `vars.a`.
 */
export function classificarCodigo(codigo: string): ClasseDoCodigo {
  const partes = codigo.split('.');
  const [ns, prop] = partes;
  const fixa = (c: string): ClasseDoCodigo => {
    const v = FIXA_POR_CODIGO.get(c);
    return v ? { tipo: 'fixa', variavel: v } : { tipo: 'vazio' };
  };
  if (ns === 'now') return prop === undefined ? fixa('now') : { tipo: 'vazio' };
  if (ns === 'deal') return prop === 'value' || prop === 'created_at' ? fixa(`deal.${prop}`) : { tipo: 'vazio' };
  if (ns === 'message') return prop === 'text' ? fixa('message.text') : { tipo: 'vazio' };
  if (ns === 'vars') return prop ? { tipo: 'evento', nome: prop } : { tipo: 'vazio' };
  if (ns === 'channel') return prop === 'id' ? fixa('channel.id') : { tipo: 'vazio' };
  if (ns === 'contact') {
    if (prop === 'campo') return { tipo: 'campo', chave: partes.slice(2).join('.') };
    return prop ? fixa(`contact.${prop}`) : { tipo: 'vazio' };
  }
  if (ns === 'conversation') return prop === 'link' ? fixa('conversation.link') : { tipo: 'vazio' };
  return { tipo: 'vazio' };
}
