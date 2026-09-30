import type { SupabaseClient } from "@supabase/supabase-js";

import { FUSO_PADRAO } from "@/lib/agenda/fuso";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { telefonesDasConexoes } from "@/lib/zapsign/buscar";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type ClienteDoAtlas, type ClienteListado, type CodigoDoErroAtlas, type PaginaDaListagem } from "./cliente";
import { lerChaveDoAtlas, registrarConferencia } from "./conexao";
import { ambienteDoAtlas, noAmbiente } from "./enderecos";
import {
  appUrlSegura,
  candidatosPeloLink,
  COLUNAS_DO_VINCULO,
  decidirMudanca,
  desdeDasMudancas,
  filtroDoCadeadoLivre,
  LIMITE_DA_PAGINA,
  LOTE_DE_IDS,
  modoDaLeitura,
  mudouHaPouco,
  ORCAMENTO_DO_CICLO_MS,
  PAGINAS_POR_CICLO,
  PAUSA_ENTRE_PAGINAS_MS,
  semDescartados,
  telefoneForte,
  TETO_CONFIRMACOES_DO_LINK,
  telefonesUnicos,
  vinculosParaConferirNaLixeira,
  type CasouPor,
  type EstadoDaLeitura,
  type ParDoVinculo,
  type TipoDaMudanca,
  type VinculoLido,
} from "./leitura";

/**
 * A LEITURA periódica das situações do Atlas (Fase 2 de
 * docs/PLANO-integracao-atlas.md) — o I/O. As regras puras estão em
 * `leitura.ts`.
 *
 * Roda no laço LENTO do agendador, num `after()` da rota `cb/asaas/cron`
 * (`rodarCicloDoAtlas`), e no "Ler situações agora" do cartão (uma conta,
 * `/api/cb/atlas/leitura`). Por conta, nesta ordem:
 *
 * 1. A conexão DESTE ambiente. Sem ela (ou de outro ambiente): sai calado.
 * 2. O CADEADO (`sincronizando_desde`): `UPDATE … RETURNING` cercado, que
 *    carimba também a tentativa (o rodízio). A posse é o carimbo; toda
 *    escrita seguinte em `cb_atlas_config` leva a cerca e confere a linha, e
 *    toda página, todo vínculo automático e toda escrita da lixeira PROVAM a
 *    posse logo antes (`provarPosse`) — zero linhas = outro processo (ou uma
 *    reconexão) tomou a conta, e o ciclo PARA (`cadeado_perdido`). A janela
 *    que sobra entre a prova e a escrita é de milissegundos.
 * 3. Passo A, as MUDANÇAS: `list_clients` com `statusChangedSince` (a última
 *    leitura − 5 min), com cursor PRÓPRIO gravado a cada página — uma
 *    mudança em massa maior que o teto de páginas continua no ciclo seguinte.
 *    Terminada, `situacoes_lidas_ate` = quando a VARREDURA começou
 *    (`mudancas_iniciada_em`, o ciclo em que ela começou).
 * 4. Passo B, a LISTAGEM COMPLETA (a primeira, a diária das 03:00, a em
 *    curso, ou a pedida): sem filtro, com cursor próprio; cada vínculo visto
 *    ganha `visto_na_listagem_em`. Terminada, `listagem_completa_em` = quando
 *    ela COMEÇOU.
 * 5. Cada página: o vínculo (conta, AMBIENTE e escritório) decide pela
 *    `decidirMudanca`; a escrita é UMA linha por vez (nada de upsert:
 *    `origem` e `atlas_tenant_id` são NOT NULL), cercada por recência
 *    (`situacao_lida_em` anterior ao pedido da página: uma leitura lenta não
 *    desfaz o que o passo "Criar cliente" gravou depois). Quem não tem
 *    vínculo vira candidato ao vínculo automático.
 * 6. O vínculo automático, só em ciclo SEM falha. Pelo LINK da conversa: na
 *    listagem completa que começou E terminou neste ciclo, a unicidade vale
 *    contra o escritório inteiro em memória; fora dela, cada par é
 *    CONFIRMADO no Atlas (`find_clients` pela ficha e pelas conversas dela,
 *    no máximo `TETO_CONFIRMACOES_DO_LINK` por ciclo) — a página não prova
 *    que só um cadastro aponta para a ficha. Pelo TELEFONE forte e único dos
 *    dois lados: só na listagem inteira. Descarta a ficha já ligada neste
 *    ambiente e o par RECUSADO por gente.
 * 7. A LIXEIRA: depois de uma listagem completa, os vínculos que ela não viu
 *    são relidos um a um (`get_client`, no máximo 5 por ciclo); só o
 *    `not_found` do Atlas marca `excluido_no_atlas_em` — o vínculo NUNCA é
 *    apagado (o Atlas restaura por 7 dias).
 * 8. O fechamento solta o cadeado, grava o erro da LEITURA (`sync_erro`,
 *    separado do erro da conexão) e, sem erro, `last_sync_at`. Só DEPOIS de
 *    ele casar a linha a conexão é marcada (`registrarConferencia`): o ciclo
 *    que perdeu a posse para uma reconexão não põe em erro a conexão nova.
 *
 * ⚠️ Os erros NÃO avançam o cursor da página que falhou. `limite` (429) para
 * a conta sem marcar a conexão; a permissão "Listar clientes" desligada é
 * `sem_permissao_listar`, SEM `registrarConferencia` (ela é opcional, e
 * marcar a conexão faria o cartão piscar com o passo "Criar cliente");
 * chave recusada e API fora do plano marcam; a API ANTIGA (sem
 * `status_changed_at`) é `api_antiga`, sem gravar nada da página.
 */

export type CodigoDaLeitura =
  | CodigoDoErroAtlas
  | "nao_conectado"
  | "chave_ilegivel"
  | "db_error"
  | "em_curso"
  | "cadeado_perdido"
  | "sem_permissao_listar"
  | "api_antiga";

export interface ContagemDaLeitura {
  paginas: number;
  clientes: number;
  porTipo: Partial<Record<TipoDaMudanca, number>>;
  gravados: number;
  /** A cerca de recência recusou: alguém gravou depois de a página ser pedida. */
  superados: number;
  vinculadosPeloLink: number;
  vinculadosPeloTelefone: number;
  ambiguos: number;
  /** O INSERT do vínculo automático deu 23505 (outro processo ligou antes). */
  conflitos: number;
  conferidosNaLixeira: number;
  naLixeira: number;
  mudancasCompletas: boolean;
  listagemCompleta: boolean;
  /** O ciclo parou por prazo ou pelo teto de páginas (o resto fica para o próximo). */
  interrompida: boolean;
}

export type ResultadoDaLeitura = { ok: true; contagem: ContagemDaLeitura } | { ok: false; codigo: CodigoDaLeitura; contagem?: ContagemDaLeitura };

type FabricaDeCliente = (chave: string) => ClienteAtlas;

export interface OpcoesDaLeitura {
  /** Instante (epoch ms, relógio REAL) depois do qual nenhuma chamada nova ao Atlas começa. */
  prazoMs: number;
  /** "Ler agora" com a listagem completa: recomeça do zero. */
  forcarCompleta?: boolean;
  cliente?: FabricaDeCliente;
  ambiente?: string | null;
  fuso?: string;
  /** A pausa entre as chamadas ao Atlas (os testes passam uma que não espera). */
  pausa?: (ms: number) => Promise<void>;
}

/** Falha que encerra o ciclo com um código; `marca` = o erro que vai à CONEXÃO (depois do fechamento cercado). */
class FalhaDaLeitura extends Error {
  constructor(
    public readonly codigo: CodigoDaLeitura,
    public readonly marca: CodigoDoErroAtlas | null = null,
  ) {
    super(codigo);
    this.name = "FalhaDaLeitura";
  }
}

const COLUNAS_DO_ESTADO = "situacoes_lidas_ate, mudancas_desde, mudancas_cursor, mudancas_iniciada_em, listagem_completa_em, listagem_iniciada_em, listagem_cursor";

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function lotes<T>(itens: T[]): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += LOTE_DE_IDS) saida.push(itens.slice(i, i + LOTE_DE_IDS));
  return saida;
}

interface Contexto {
  admin: SupabaseClient;
  accountId: string;
  ambiente: string | null;
  tenantId: string;
  posse: string;
  inicio: string;
  prazoMs: number;
  atlas: ClienteAtlas;
  pausa: (ms: number) => Promise<void>;
  contagem: ContagemDaLeitura;
  chamadas: number;
  chamouOAtlas: boolean;
  /** Pares do link já confirmados no Atlas neste ciclo (`TETO_CONFIRMACOES_DO_LINK`). */
  confirmacoes: number;
  /** Clientes já decididos neste ciclo (o cursor por `(updated_at, id)` repete). */
  processados: Set<string>;
  /** Clientes do Atlas que TÊM vínculo (neste ambiente e escritório). */
  vinculados: Set<string>;
  /** Mudaram há menos de 2 min: nem gravados, nem candidatos. */
  recentes: Set<string>;
  /** Sem vínculo e com uuids no link: candidatos ao vínculo pelo link. */
  semVinculo: Map<string, ClienteListado>;
  /** A listagem completa que COMEÇOU neste ciclo (o telefone precisa dela inteira); nulo = não serve. */
  listagem: Map<string, ClienteListado> | null;
  /** A listagem em andamento neste ciclo e quando ela começou (o `visto_na_listagem_em`). */
  listagemIniciadaEm: string | null;
  vistosNaListagem: Set<string>;
  /** Quando terminou uma listagem completa NESTE ciclo. */
  listagemTerminadaEm: string | null;
  /** Clientes que o link casou com alguma ficha, e as fichas dos pares do link. */
  comFichaPeloLink: Set<string>;
  fichasDoLink: Set<string>;
}

function contagemZerada(): ContagemDaLeitura {
  return {
    paginas: 0,
    clientes: 0,
    porTipo: {},
    gravados: 0,
    superados: 0,
    vinculadosPeloLink: 0,
    vinculadosPeloTelefone: 0,
    ambiguos: 0,
    conflitos: 0,
    conferidosNaLixeira: 0,
    naLixeira: 0,
    mudancasCompletas: false,
    listagemCompleta: false,
    interrompida: false,
  };
}

/** Escreve na conexão COM a cerca de posse; zero linhas aborta o ciclo. */
async function gravarNaConfig(ctx: Contexto, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await noAmbiente(ctx.admin.from("cb_atlas_config").update(patch).eq("account_id", ctx.accountId), ctx.ambiente)
    .eq("sincronizando_desde", ctx.posse)
    .select("account_id");
  if (error) throw new Error(`conexão: ${error.message}`);
  if (!data || data.length === 0) throw new FalhaDaLeitura("cadeado_perdido");
}

/**
 * Prova a posse logo antes de escrever fora da conexão (vínculos): o ciclo
 * que perdeu o cadeado para uma reconexão não grava com o escritório antigo
 * depois de `apagarVinculosAnteriores` (CLAUDE.md 8e).
 */
async function provarPosse(ctx: Contexto): Promise<void> {
  await gravarNaConfig(ctx, { last_sync_attempt_at: ctx.posse });
}

/** Antes de cada chamada ao Atlas: a pausa (menos na primeira) e o prazo pelo relógio REAL. */
async function podeChamar(ctx: Contexto): Promise<boolean> {
  if (ctx.chamadas > 0) await ctx.pausa(PAUSA_ENTRE_PAGINAS_MS);
  if (Date.now() >= ctx.prazoMs) {
    ctx.contagem.interrompida = true;
    return false;
  }
  ctx.chamadas++;
  return true;
}

async function pedirPagina(ctx: Contexto, filtro: { statusChangedSince?: string; cursor: string | null }): Promise<{ pagina: PaginaDaListagem; pedidoEm: string } | null> {
  if (ctx.contagem.paginas >= PAGINAS_POR_CICLO) {
    ctx.contagem.interrompida = true;
    return null;
  }
  if (!(await podeChamar(ctx))) return null;
  const pedidoEm = new Date().toISOString();
  const pagina = await ctx.atlas.listar({ ...filtro, limit: LIMITE_DA_PAGINA });
  ctx.contagem.paginas++;
  ctx.chamouOAtlas = true;
  return { pagina, pedidoEm };
}

/** Os vínculos dos clientes, por conta, AMBIENTE e escritório (o de outro escritório é invisível). */
async function lerVinculos(ctx: Contexto, atlasIds: string[]): Promise<Map<string, VinculoLido>> {
  const mapa = new Map<string, VinculoLido>();
  for (const lote of lotes(atlasIds)) {
    const { data, error } = await noAmbiente(ctx.admin.from("cb_atlas_clientes").select(COLUNAS_DO_VINCULO).eq("account_id", ctx.accountId), ctx.ambiente)
      .eq("atlas_tenant_id", ctx.tenantId)
      .in("atlas_client_id", lote);
    if (error) throw new Error(`vínculos: ${error.message}`);
    for (const v of (data ?? []) as VinculoLido[]) mapa.set(String(v.atlas_client_id), v);
  }
  return mapa;
}

/** Grava a situação lida num vínculo, cercada por recência. Devolve se gravou. */
async function gravarSituacao(ctx: Contexto, vinculo: VinculoLido, cliente: Pick<ClienteDoAtlas, "id" | "status" | "appUrl" | "situacaoDesde">, pedidoEm: string): Promise<boolean> {
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    situacao: cliente.status,
    situacao_desde: cliente.situacaoDesde ?? null,
    situacao_lida_em: agora,
    excluido_no_atlas_em: null,
    updated_at: agora,
  };
  const url = appUrlSegura(cliente.appUrl, cliente.id);
  if (url) patch.app_url = url;
  const { data, error } = await noAmbiente(
    ctx.admin.from("cb_atlas_clientes").update(patch).eq("id", vinculo.id).eq("account_id", ctx.accountId),
    ctx.ambiente,
  )
    .or(`situacao_lida_em.is.null,situacao_lida_em.lt.${pedidoEm}`)
    .select("id");
  if (error) throw new Error(`gravar a situação: ${error.message}`);
  if (!data || data.length === 0) {
    // Alguém (o passo "Criar cliente") gravou depois de a página ser pedida: o dele vale.
    ctx.contagem.superados++;
    return false;
  }
  ctx.contagem.gravados++;
  return true;
}

async function processarPagina(ctx: Contexto, clientes: ClienteListado[], pedidoEm: string): Promise<void> {
  await provarPosse(ctx);
  const naListagem = ctx.listagemIniciadaEm;
  if (naListagem !== null) {
    for (const c of clientes) {
      if (ctx.vistosNaListagem.has(c.id)) continue;
      ctx.vistosNaListagem.add(c.id);
      ctx.listagem?.set(c.id, c);
    }
  }
  const vinculos = await lerVinculos(ctx, [...new Set(clientes.map((c) => c.id))]);
  if (naListagem !== null && vinculos.size > 0) {
    // A listagem viu estes vínculos: ficam fora da conferência da lixeira.
    for (const lote of lotes([...vinculos.values()].map((v) => v.id))) {
      const { error } = await noAmbiente(
        ctx.admin.from("cb_atlas_clientes").update({ visto_na_listagem_em: naListagem }).eq("account_id", ctx.accountId),
        ctx.ambiente,
      ).in("id", lote);
      if (error) throw new Error(`visto na listagem: ${error.message}`);
    }
  }
  const agora = new Date();
  for (const c of clientes) {
    const vinculo = vinculos.get(c.id);
    if (vinculo) ctx.vinculados.add(c.id);
    if (ctx.processados.has(c.id)) continue;
    ctx.processados.add(c.id);
    ctx.contagem.clientes++;
    if (mudouHaPouco(c.situacaoDesde, agora)) ctx.recentes.add(c.id);
    if (vinculo) {
      const decisao = decidirMudanca(vinculo, c, agora);
      ctx.contagem.porTipo[decisao.tipo] = (ctx.contagem.porTipo[decisao.tipo] ?? 0) + 1;
      // A Fase 4 enfileira aqui o evento, quando `viraEvento(decisao)` e a escrita pegou.
      if (decisao.grava) await gravarSituacao(ctx, vinculo, c, pedidoEm);
      continue;
    }
    if (!ctx.recentes.has(c.id) && c.sinais.uuidsDoLink.length > 0) ctx.semVinculo.set(c.id, c);
  }
}

async function passoDasMudancas(ctx: Contexto, estado: EstadoDaLeitura): Promise<void> {
  // Retoma a varredura em curso (o `statusChangedSince` dela é FIXO) ou começa uma.
  const retomar = !!estado.mudancas_cursor && !!estado.mudancas_desde && !!estado.mudancas_iniciada_em;
  const desde = retomar ? estado.mudancas_desde! : desdeDasMudancas(estado.situacoes_lidas_ate!);
  const iniciadaEm = retomar ? estado.mudancas_iniciada_em! : ctx.inicio;
  let cursor = retomar ? estado.mudancas_cursor : null;
  for (;;) {
    const r = await pedirPagina(ctx, { statusChangedSince: desde, cursor });
    if (!r) return;
    await processarPagina(ctx, r.pagina.clientes, r.pedidoEm);
    if (r.pagina.hasMore) {
      cursor = r.pagina.nextCursor;
      await gravarNaConfig(ctx, { mudancas_desde: desde, mudancas_cursor: cursor, mudancas_iniciada_em: iniciadaEm });
      continue;
    }
    // ⚠️ Quando a VARREDURA começou (pode ter sido ciclos atrás), nunca o
    // início deste ciclo: o cliente que ela pulou por ser `recente` mudou há
    // menos de 2 min de quando foi lido — depois do início dela menos a
    // sobreposição —, e o cursor `(updated_at, id)` já passou por ele. Só a
    // próxima varredura, a partir DESSE início, o relê.
    await gravarNaConfig(ctx, { situacoes_lidas_ate: iniciadaEm, mudancas_desde: null, mudancas_cursor: null, mudancas_iniciada_em: null });
    ctx.contagem.mudancasCompletas = true;
    return;
  }
}

async function passoDaListagem(ctx: Contexto, estado: EstadoDaLeitura, recomecar: boolean): Promise<void> {
  const iniciadaEm = recomecar ? ctx.inicio : estado.listagem_iniciada_em!;
  let cursor = recomecar ? null : estado.listagem_cursor;
  if (recomecar) await gravarNaConfig(ctx, { listagem_iniciada_em: iniciadaEm, listagem_cursor: null });
  ctx.listagemIniciadaEm = iniciadaEm;
  // O telefone precisa da listagem INTEIRA em memória: só a que começa aqui serve.
  ctx.listagem = recomecar ? new Map() : null;
  for (;;) {
    const r = await pedirPagina(ctx, { cursor });
    if (!r) {
      ctx.listagem = null;
      return;
    }
    await processarPagina(ctx, r.pagina.clientes, r.pedidoEm);
    if (r.pagina.hasMore) {
      cursor = r.pagina.nextCursor;
      await gravarNaConfig(ctx, { listagem_cursor: cursor });
      continue;
    }
    // A primeira listagem abre as MUDANÇAS a partir de quando ela começou: a
    // sobreposição do passo A cobre o que mudou durante ela.
    await gravarNaConfig(ctx, {
      listagem_completa_em: iniciadaEm,
      listagem_cursor: null,
      ...(estado.situacoes_lidas_ate === null ? { situacoes_lidas_ate: iniciadaEm } : {}),
    });
    ctx.listagemTerminadaEm = iniciadaEm;
    ctx.contagem.listagemCompleta = true;
    return;
  }
}

/** A ficha já ligada neste ambiente (de qualquer escritório: a chave é por ambiente) e os pares recusados. */
async function descartados(ctx: Contexto, pares: ParDoVinculo[]): Promise<ParDoVinculo[]> {
  const fichas = [...new Set(pares.map((p) => p.contactId))];
  const ligadas = new Set<string>();
  const recusas = new Set<string>();
  for (const lote of lotes(fichas)) {
    const { data, error } = await noAmbiente(ctx.admin.from("cb_atlas_clientes").select("contact_id").eq("account_id", ctx.accountId), ctx.ambiente).in(
      "contact_id",
      lote,
    );
    if (error) throw new Error(`fichas já ligadas: ${error.message}`);
    for (const l of (data ?? []) as { contact_id: string }[]) ligadas.add(String(l.contact_id));
    const { data: rec, error: erroRec } = await noAmbiente(
      ctx.admin.from("cb_atlas_recusas").select("contact_id, atlas_client_id").eq("account_id", ctx.accountId),
      ctx.ambiente,
    ).in("contact_id", lote);
    if (erroRec) throw new Error(`recusas: ${erroRec.message}`);
    for (const r of (rec ?? []) as { contact_id: string; atlas_client_id: string }[]) recusas.add(`${r.contact_id}:${r.atlas_client_id}`);
  }
  return semDescartados(pares, ligadas, recusas);
}

/**
 * O vínculo automático nasce COM a situação lida: nunca vira evento. 23505 =
 * outro ligou antes. ⚠️ A prova de posse ANTES e DEPOIS: uma reconexão com
 * outro escritório entre a prova e o INSERT (que apaga os vínculos antigos)
 * deixaria este, com o escritório velho, ocupando a chave da ficha — a prova
 * de depois que falha o APAGA antes de parar o ciclo.
 */
async function inserirVinculo(ctx: Contexto, cliente: ClienteListado, contactId: string, casouPor: CasouPor): Promise<void> {
  await provarPosse(ctx);
  const agora = new Date().toISOString();
  const { data: inserido, error } = await ctx.admin.from("cb_atlas_clientes").insert({
    account_id: ctx.accountId,
    api_url: ctx.ambiente,
    atlas_tenant_id: ctx.tenantId,
    atlas_client_id: cliente.id,
    contact_id: contactId,
    app_url: appUrlSegura(cliente.appUrl, cliente.id),
    situacao: cliente.status,
    situacao_desde: cliente.situacaoDesde,
    situacao_lida_em: agora,
    origem: "automatica",
    casou_por: casouPor,
    visto_na_listagem_em: ctx.vistosNaListagem.has(cliente.id) ? ctx.listagemIniciadaEm : null,
    updated_at: agora,
  }).select("id");
  if (!error) {
    try {
      await provarPosse(ctx);
    } catch (perdeu) {
      const ids = ((inserido ?? []) as { id: string }[]).map((l) => l.id);
      if (ids.length > 0) {
        const { error: erroDesfazer } = await ctx.admin.from("cb_atlas_clientes").delete().in("id", ids).eq("account_id", ctx.accountId);
        if (erroDesfazer) console.error("[atlas] vínculo gravado depois de perder o cadeado e não desfeito:", erroDesfazer.message);
      }
      throw perdeu;
    }
    if (casouPor === "chat_link") ctx.contagem.vinculadosPeloLink++;
    else ctx.contagem.vinculadosPeloTelefone++;
    return;
  }
  if ((error as { code?: string }).code === "23505") {
    ctx.contagem.conflitos++;
    return;
  }
  throw new Error(`vínculo automático: ${error.message}`);
}

/**
 * Fora da listagem inteira, a página não prova que só ESTE cadastro aponta
 * para a ficha (o ex-cliente que voltou tem o velho e o novo com o link da
 * mesma conversa, e só um mudou de situação): o Atlas confirma, pelo
 * `find_clients` com a ficha e as conversas dela. Sem prova, adia.
 */
async function confirmarPeloLink(ctx: Contexto, par: ParDoVinculo): Promise<"unico" | "ambiguo" | "adiado"> {
  if (ctx.confirmacoes >= TETO_CONFIRMACOES_DO_LINK) return "adiado";
  const { data, error } = await ctx.admin.from("conversations").select("id").eq("account_id", ctx.accountId).eq("contact_id", par.contactId).limit(10);
  if (error) throw new Error(`conversas da ficha: ${error.message}`);
  const conversas = ((data ?? []) as { id: string }[]).map((c) => String(c.id));
  // O Atlas aceita 10 ids: com mais conversas, a busca não cobre a ficha inteira.
  if (conversas.length > 9) return "adiado";
  if (!(await podeChamar(ctx))) return "adiado";
  ctx.confirmacoes++;
  let achados: { clientes: ClienteDoAtlas[]; truncado: boolean };
  try {
    achados = await ctx.atlas.buscar({ chatLinkIds: [par.contactId, ...conversas] });
  } catch (e) {
    // `find_clients` é "Consultar clientes", permissão OBRIGATÓRIA: marca a conexão.
    if (e instanceof AtlasError && e.codigo === "sem_permissao") throw new FalhaDaLeitura("sem_permissao", "sem_permissao");
    throw e;
  }
  ctx.chamouOAtlas = true;
  if (achados.truncado || achados.clientes.length > 1) return "ambiguo";
  return achados.clientes.length === 1 && achados.clientes[0].id === par.atlasClientId ? "unico" : "adiado";
}

async function vincularPeloLink(ctx: Contexto): Promise<void> {
  if (ctx.semVinculo.size === 0) return;
  // A listagem que começou E terminou neste ciclo tem o escritório inteiro em
  // memória: a ficha disputada por QUALQUER cliente dela (já ligado, recente)
  // é ambígua. Fora dela, cada par precisa da confirmação do Atlas.
  const inteira = ctx.listagemTerminadaEm !== null && ctx.listagem !== null;
  const base = inteira ? [...ctx.listagem!.values()].filter((c) => c.sinais.uuidsDoLink.length > 0) : [...ctx.semVinculo.values()];
  const uuids = [...new Set(base.flatMap((c) => c.sinais.uuidsDoLink))];
  const conversas = new Map<string, string | null>();
  const contatos = new Set<string>();
  for (const lote of lotes(uuids)) {
    const { data, error } = await ctx.admin.from("conversations").select("id, contact_id").eq("account_id", ctx.accountId).in("id", lote);
    if (error) throw new Error(`conversas do link: ${error.message}`);
    for (const c of (data ?? []) as { id: string; contact_id: string | null }[]) conversas.set(String(c.id), c.contact_id ? String(c.contact_id) : null);
    const { data: fichas, error: erroFichas } = await ctx.admin.from("contacts").select("id").eq("account_id", ctx.accountId).in("id", lote);
    if (erroFichas) throw new Error(`fichas do link: ${erroFichas.message}`);
    for (const f of (fichas ?? []) as { id: string }[]) contatos.add(String(f.id));
  }
  const { pares, ambiguos, comAlgumaFicha, fichasTocadas } = candidatosPeloLink(
    base.map((c) => ({ id: c.id, uuids: c.sinais.uuidsDoLink })),
    conversas,
    contatos,
  );
  ctx.contagem.ambiguos += ambiguos;
  ctx.comFichaPeloLink = comAlgumaFicha;
  // Reservadas para o telefone: TODA ficha que o link citou, aceita ou disputada.
  ctx.fichasDoLink = fichasTocadas;
  for (const p of await descartados(
    ctx,
    pares.filter((p) => ctx.semVinculo.has(p.atlasClientId)),
  )) {
    if (!inteira) {
      const confirmado = await confirmarPeloLink(ctx, p);
      if (confirmado === "ambiguo") ctx.contagem.ambiguos++;
      if (confirmado !== "unico") continue;
    }
    await inserirVinculo(ctx, ctx.semVinculo.get(p.atlasClientId)!, p.contactId, "chat_link");
  }
}

async function vincularPeloTelefone(ctx: Contexto): Promise<void> {
  const listagem = ctx.listagem;
  if (!listagem || listagem.size === 0) return;
  // Sem os números das conexões, um cliente com o número do escritório
  // ligaria à ficha do próprio escritório: não roda neste ciclo.
  const conexoes = await telefonesDasConexoes(ctx.admin, ctx.accountId);
  if (!conexoes.ok) {
    console.warn(`[atlas] vínculo pelo telefone adiado na conta ${ctx.accountId}: ${conexoes.erro}`);
    return;
  }
  const dasConexoes = new Set(conexoes.valor.map(telefoneForte).filter((t): t is string => t !== null));
  const fora = new Set([...ctx.vinculados, ...ctx.comFichaPeloLink, ...ctx.recentes]);
  const unicos = telefonesUnicos(
    [...listagem.values()].map((c) => ({ id: c.id, telefone: c.sinais.telefoneCanonico })),
    fora,
    dasConexoes,
  );
  if (unicos.size === 0) return;
  const pares: ParDoVinculo[] = [];
  for (const lote of lotes([...unicos.keys()])) {
    const { data, error } = await ctx.admin.from("contacts").select("id, telefone_canonico").eq("account_id", ctx.accountId).in("telefone_canonico", lote);
    if (error) throw new Error(`fichas pelo telefone: ${error.message}`);
    for (const f of (data ?? []) as { id: string; telefone_canonico: string }[]) {
      const atlasClientId = unicos.get(String(f.telefone_canonico));
      if (atlasClientId && !ctx.fichasDoLink.has(String(f.id))) pares.push({ atlasClientId, contactId: String(f.id) });
    }
  }
  // A 1024 garante uma ficha por telefone na conta; ainda assim, ficha repetida não liga.
  const porFicha = new Map<string, number>();
  for (const p of pares) porFicha.set(p.contactId, (porFicha.get(p.contactId) ?? 0) + 1);
  const unicosDosDoisLados = pares.filter((p) => porFicha.get(p.contactId) === 1);
  for (const p of await descartados(ctx, unicosDosDoisLados)) await inserirVinculo(ctx, listagem.get(p.atlasClientId)!, p.contactId, "telefone");
}

async function conferirLixeira(ctx: Contexto, completaEm: string): Promise<void> {
  const linhas: VinculoLido[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const { data, error } = await noAmbiente(ctx.admin.from("cb_atlas_clientes").select(COLUNAS_DO_VINCULO).eq("account_id", ctx.accountId), ctx.ambiente)
      .eq("atlas_tenant_id", ctx.tenantId)
      .not("contact_id", "is", null)
      .is("excluido_no_atlas_em", null)
      .lt("created_at", completaEm)
      .or(`visto_na_listagem_em.is.null,visto_na_listagem_em.lt.${completaEm}`)
      .order("id")
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw new Error(`lixeira: ${error.message}`);
    linhas.push(...((data ?? []) as VinculoLido[]));
    if ((data ?? []).length < 1000) break;
  }
  for (const vinculo of vinculosParaConferirNaLixeira(linhas, completaEm)) {
    if (!(await podeChamar(ctx))) return;
    const pedidoEm = new Date().toISOString();
    let lido: ClienteDoAtlas | null;
    try {
      lido = await ctx.atlas.ler(vinculo.atlas_client_id);
    } catch (e) {
      // `get_client` é "Consultar clientes", permissão OBRIGATÓRIA da conexão: aqui sim marca.
      if (e instanceof AtlasError && e.codigo === "sem_permissao") throw new FalhaDaLeitura("sem_permissao", "sem_permissao");
      throw e;
    }
    ctx.chamouOAtlas = true;
    ctx.contagem.conferidosNaLixeira++;
    await provarPosse(ctx);
    const agora = new Date().toISOString();
    if (lido === null) {
      // Só o `not_found` DO ATLAS chega aqui como nulo: marca, nunca apaga.
      const { error } = await noAmbiente(
        ctx.admin.from("cb_atlas_clientes").update({ excluido_no_atlas_em: agora, updated_at: agora }).eq("id", vinculo.id).eq("account_id", ctx.accountId),
        ctx.ambiente,
      ).is("excluido_no_atlas_em", null);
      if (error) throw new Error(`marcar na lixeira: ${error.message}`);
      ctx.contagem.naLixeira++;
      continue;
    }
    // Existe (a listagem o perdeu numa escrita concorrente): grava como qualquer página.
    const decisao = decidirMudanca(vinculo, lido, new Date());
    ctx.contagem.porTipo[decisao.tipo] = (ctx.contagem.porTipo[decisao.tipo] ?? 0) + 1;
    if (decisao.grava) await gravarSituacao(ctx, vinculo, lido, pedidoEm);
    const { error } = await noAmbiente(
      ctx.admin.from("cb_atlas_clientes").update({ visto_na_listagem_em: completaEm }).eq("id", vinculo.id).eq("account_id", ctx.accountId),
      ctx.ambiente,
    );
    if (error) throw new Error(`visto na conferência: ${error.message}`);
  }
}

/**
 * O erro vira o código da leitura e, quando for o caso, o erro da CONEXÃO
 * (chave recusada, plano sem API, "Consultar clientes" desligada). Não
 * escreve: a marca só vai depois do fechamento cercado.
 */
function codigoDaFalha(ctx: Contexto, e: unknown): { codigo: CodigoDaLeitura; marca: CodigoDoErroAtlas | null } {
  if (e instanceof FalhaDaLeitura) return { codigo: e.codigo, marca: e.marca };
  if (e instanceof AtlasError) {
    console.warn(`[atlas] leitura da conta ${ctx.accountId} parou (${e.codigo}):`, e.message);
    switch (e.codigo) {
      case "sem_permissao":
        // A listagem é "Listar clientes", permissão OPCIONAL: nunca marca a conexão.
        return { codigo: "sem_permissao_listar", marca: null };
      case "chave_invalida":
      case "api_fora_do_plano":
        return { codigo: e.codigo, marca: e.codigo };
      case "resposta_inesperada":
        return { codigo: e.apiAntiga ? "api_antiga" : "resposta_inesperada", marca: null };
      default:
        return { codigo: e.codigo, marca: null };
    }
  }
  console.error(`[atlas] leitura da conta ${ctx.accountId} falhou no banco:`, e instanceof Error ? e.message : e);
  return { codigo: "db_error", marca: null };
}

export async function sincronizarSituacoes(admin: SupabaseClient, accountId: string, opcoes: OpcoesDaLeitura): Promise<ResultadoDaLeitura> {
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;

  // 1) A conexão deste ambiente.
  const conexao = await lerChaveDoAtlas(admin, accountId, ambiente);
  if (!conexao.ok) {
    // Sem conexão, ou a de OUTRO ambiente (o preview contra o staging): calado.
    if (conexao.codigo === "nao_conectado" || conexao.codigo === "outro_ambiente") return { ok: false, codigo: "nao_conectado" };
    if (conexao.codigo === "chave_ilegivel") {
      // SEM escrita: antes do cadeado não há cerca, e uma reconexão no meio
      // levaria o "ilegível" da chave velha para a conexão NOVA. Quem marca a
      // conexão é o passo "Criar cliente" e o "Conferir de novo" (que leem a
      // chave e escrevem na hora); a leitura só registra no log.
      console.warn(`[atlas] leitura da conta ${accountId}: a chave guardada não pôde ser decifrada`);
      return { ok: false, codigo: "chave_ilegivel" };
    }
    console.error(`[atlas] leitura da conta ${accountId}: a conexão não pôde ser lida`);
    return { ok: false, codigo: "db_error" };
  }

  // 2) O cadeado, que carimba a tentativa (o rodízio) — e só do escritório da chave lida.
  const inicio = new Date();
  const posse = inicio.toISOString();
  const { data: reivindicadas, error: erroCadeado } = await noAmbiente(
    admin.from("cb_atlas_config").update({ sincronizando_desde: posse, last_sync_attempt_at: posse }).eq("account_id", accountId),
    ambiente,
  )
    .eq("atlas_tenant_id", conexao.tenantId)
    .or(filtroDoCadeadoLivre(inicio.getTime()))
    .select(COLUNAS_DO_ESTADO);
  if (erroCadeado) {
    console.error("[atlas] cadeado da leitura:", erroCadeado.message);
    return { ok: false, codigo: "db_error" };
  }
  const linha = (reivindicadas ?? [])[0] as Record<string, string | null> | undefined;
  if (!linha) return { ok: false, codigo: "em_curso" };
  const estado: EstadoDaLeitura = {
    situacoes_lidas_ate: linha.situacoes_lidas_ate ?? null,
    mudancas_desde: linha.mudancas_desde ?? null,
    mudancas_cursor: linha.mudancas_cursor ?? null,
    mudancas_iniciada_em: linha.mudancas_iniciada_em ?? null,
    listagem_completa_em: linha.listagem_completa_em ?? null,
    listagem_iniciada_em: linha.listagem_iniciada_em ?? null,
    listagem_cursor: linha.listagem_cursor ?? null,
  };

  const ctx: Contexto = {
    admin,
    accountId,
    ambiente,
    tenantId: conexao.tenantId,
    posse,
    inicio: posse,
    prazoMs: opcoes.prazoMs,
    atlas: (opcoes.cliente ?? ((c) => criarClienteAtlas(c)))(conexao.chave),
    pausa: opcoes.pausa ?? esperar,
    contagem: contagemZerada(),
    chamadas: 0,
    chamouOAtlas: false,
    confirmacoes: 0,
    processados: new Set(),
    vinculados: new Set(),
    recentes: new Set(),
    semVinculo: new Map(),
    listagem: null,
    listagemIniciadaEm: null,
    vistosNaListagem: new Set(),
    listagemTerminadaEm: null,
    comFichaPeloLink: new Set(),
    fichasDoLink: new Set(),
  };

  let falha: unknown = null;
  try {
    const modo = modoDaLeitura(estado, inicio, opcoes.fuso ?? FUSO_PADRAO, opcoes.forcarCompleta === true);
    if (modo.mudancas) await passoDasMudancas(ctx, estado);
    if (modo.listagem) await passoDaListagem(ctx, estado, modo.recomecar);
  } catch (e) {
    falha = e;
  }
  // O vínculo automático só em ciclo SEM falha: fora da listagem inteira ele
  // confirma no Atlas (que acabou de falhar), e a listagem inteira só existe
  // sem falha. As páginas lidas voltam na próxima varredura.
  if (falha === null) {
    try {
      await vincularPeloLink(ctx);
      await vincularPeloTelefone(ctx);
      const completaEm = ctx.listagemTerminadaEm ?? estado.listagem_completa_em;
      if (completaEm) await conferirLixeira(ctx, completaEm);
    } catch (e) {
      falha = e;
    }
  }
  const { codigo: erro, marca } = falha === null ? { codigo: null, marca: null } : codigoDaFalha(ctx, falha);
  if (erro === "cadeado_perdido") {
    console.warn(`[atlas] leitura da conta ${accountId}: cadeado perdido (outro processo ou reconexão) — nada mais é gravado`);
    return { ok: false, codigo: erro, contagem: ctx.contagem };
  }

  // 8) A conferência da chave, ANTES de soltar o cadeado e com a MESMA cerca
  //    de posse: depois do fechamento, uma reconexão no meio deixaria o erro
  //    da chave velha marcar a conexão nova.
  if (erro === null && ctx.chamouOAtlas) await registrarConferencia(admin, accountId, null, ambiente, { sincronizandoDesde: posse });
  if (marca !== null) await registrarConferencia(admin, accountId, marca, ambiente, { sincronizandoDesde: posse });

  // 9) O fechamento, com a posse.
  const { data: fechou, error: erroFecho } = await noAmbiente(
    admin
      .from("cb_atlas_config")
      // `last_sync_at` = a última leitura que FALOU com o Atlas e não errou;
      // um ciclo que o prazo nem deixou chamar não afirma nada (nem limpa o
      // erro anterior).
      .update({
        sincronizando_desde: null,
        ...(erro !== null ? { sync_erro: erro } : ctx.chamouOAtlas ? { sync_erro: null, last_sync_at: new Date().toISOString() } : {}),
      })
      .eq("account_id", accountId),
    ambiente,
  )
    .eq("sincronizando_desde", posse)
    .select("account_id");
  if (erroFecho || !fechou || fechou.length === 0) {
    console.warn(`[atlas] leitura da conta ${accountId}: o fechamento não achou o cadeado (cadeado_perdido)`);
    return { ok: false, codigo: "cadeado_perdido", contagem: ctx.contagem };
  }
  return erro === null ? { ok: true, contagem: ctx.contagem } : { ok: false, codigo: erro, contagem: ctx.contagem };
}

/**
 * O ciclo de TODAS as contas deste ambiente (o `after()` da rota
 * `cb/asaas/cron`). Rodízio por `last_sync_attempt_at` (nulos primeiro),
 * orçamento de `ORCAMENTO_DO_CICLO_MS` pelo relógio real — a conta que não
 * coube entra primeiro no ciclo seguinte. NUNCA lança.
 */
export async function rodarCicloDoAtlas(opcoes: { admin?: SupabaseClient; cliente?: FabricaDeCliente; pausa?: (ms: number) => Promise<void> } = {}): Promise<void> {
  try {
    const admin = opcoes.admin ?? supabaseAdmin();
    const ambiente = ambienteDoAtlas();
    const inicio = Date.now();
    const contas: string[] = [];
    for (let pagina = 0; pagina < 20; pagina++) {
      const { data, error } = await noAmbiente(admin.from("cb_atlas_config").select("account_id"), ambiente)
        .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
        .order("account_id")
        .range(pagina * 1000, pagina * 1000 + 999);
      if (error) {
        console.error("[atlas] leitura: as conexões não puderam ser lidas:", error.message);
        return;
      }
      const linhas = (data ?? []) as { account_id: string }[];
      contas.push(...linhas.map((l) => String(l.account_id)));
      if (linhas.length < 1000) break;
    }
    let ok = 0;
    let falhas = 0;
    let adiadas = 0;
    for (const accountId of contas) {
      if (Date.now() - inicio > ORCAMENTO_DO_CICLO_MS) {
        adiadas++;
        continue;
      }
      const r = await sincronizarSituacoes(admin, accountId, {
        prazoMs: inicio + ORCAMENTO_DO_CICLO_MS,
        ambiente,
        ...(opcoes.cliente ? { cliente: opcoes.cliente } : {}),
        ...(opcoes.pausa ? { pausa: opcoes.pausa } : {}),
      });
      if (r.ok) {
        ok++;
        const c = r.contagem;
        console.log(
          `[atlas] leitura da conta ${accountId}: ${c.paginas} páginas, ${c.clientes} clientes, ${c.gravados} gravados, ${c.vinculadosPeloLink} ligados pelo link, ${c.vinculadosPeloTelefone} pelo telefone, ${c.naLixeira} na lixeira${c.interrompida ? " (continua no próximo ciclo)" : ""}`,
        );
      } else if (r.codigo === "nao_conectado") continue;
      else if (r.codigo === "em_curso" || r.codigo === "cadeado_perdido") adiadas++;
      else falhas++;
    }
    if (ok || falhas || adiadas) console.log(`[atlas] ciclo da leitura: ${ok} ok, ${falhas} falha(s), ${adiadas} adiada(s)`);
  } catch (e) {
    console.error("[atlas] ciclo da leitura falhou:", e instanceof Error ? e.message : e);
  }
}
