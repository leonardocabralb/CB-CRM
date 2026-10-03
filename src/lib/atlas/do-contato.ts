/**
 * Puro: o Atlas de UM contato como a tela o vê (Fase 2, PR B) — a resposta
 * da rota `GET /api/cb/atlas/contato/[contactId]`, montada no servidor
 * (`respostaDoContato`) e lida no navegador (`lerAtlasDoContato`). Um lugar
 * só para os dois lados, sem nada de servidor (o hook o importa).
 *
 * ⚠️ `velha` é calculada no SERVIDOR: o React Compiler recusa `Date.now()`
 * no render, e a faixa e a aba só leem o booleano.
 * ⚠️ `appUrl` só sai `https:` e com o id do cliente (`appUrlSegura`): o
 * endereço vem de fora e vira `href` — um `javascript:` seria XSS.
 */

import { appUrlSegura, leituraVelha, lidaEm, situacaoComparavel } from "./leitura";

/** As situações do Atlas (contrato §8) que a tela traduz; outra vira o texto de reserva. */
export const SITUACOES_DO_ATLAS = ["ativo", "importado", "finalizado", "rescindido", "inativo", "suspenso"] as const;
export type SituacaoDoAtlas = (typeof SITUACOES_DO_ATLAS)[number];

/**
 * Os códigos que o `PUT /api/cb/atlas/contato/[contactId]/vinculo` devolve
 * em `error` — a aba traduz cada um (`Inbox.atlas.erro.<código>`, cobrado
 * nos dois dicionários por `do-contato.test.ts`); outro vira a frase genérica.
 */
export const ERROS_DO_VINCULO = [
  "link_invalido",
  "contato_nao_encontrado",
  "nao_conectado",
  "outro_ambiente",
  "chave_ilegivel",
  "chave_invalida",
  "api_fora_do_plano",
  "sem_permissao",
  "nao_encontrado",
  "ainda_na_lixeira",
  "limite",
  "indisponivel",
  "ja_vinculado",
  "ligado_a_outra_ficha",
  "outro_escritorio",
  "sem_vinculo",
  "db_error",
] as const;
export type ErroDoVinculo = (typeof ERROS_DO_VINCULO)[number];

export function ehErroDoVinculo(v: unknown): v is ErroDoVinculo {
  return typeof v === "string" && (ERROS_DO_VINCULO as readonly string[]).includes(v);
}

/** O vínculo da ficha, pronto para a tela. */
export interface VinculoNaTela {
  atlasClientId: string;
  /** Só `https:` e com o id do cliente; nulo = sem botão. */
  appUrl: string | null;
  /** Como o Atlas escreve (`rescindido`, `Ativo`, `em_negociacao`…); nula = ainda não lida. */
  situacao: string | null;
  /** Quando mudou no Atlas (`status_changed_at`); nula = o Atlas não sabe. */
  situacaoDesde: string | null;
  origem: string | null;
  casouPor: string | null;
  /** Visto na LIXEIRA do Atlas em (restaurável por 7 dias); nulo = fora dela. */
  excluidoEm: string | null;
  /** A última confirmação da situação: a da linha ou a da varredura inteira. */
  lidaEm: string | null;
  /** A leitura está velha (sem leitura há mais de 60 min, ou com erro)? */
  velha: boolean;
}

export interface AtlasDoContato {
  /** A conta tem a conexão do Atlas DESTE ambiente? */
  conectado: boolean;
  vinculo: VinculoNaTela | null;
  /** O `sync_erro` da conexão (código nosso), para a tela dizer por que a leitura parou. */
  erroDaLeitura: string | null;
}

/**
 * O balde da rota, por usuário (fora de `rate-limit.ts`, que é do upstream).
 * ⚠️ Próprio, e não o `execucao` (30/min): o fio e o painel — sempre montado,
 * mesmo fechado — leem JUNTOS a cada troca de conversa, e quem folheasse 16
 * conversas num minuto levava 429: a linha do Atlas sumia da faixa sem aviso.
 * É a medida do `reunioesDoContato` (leitura que acompanha a troca de cliente).
 */
export const LEITURA_DO_CONTATO = { limit: 120, windowMs: 60_000 } as const;

/** As colunas da conexão que a rota lê (nunca a chave). */
export const COLUNAS_DA_CONFIG = "api_url, atlas_tenant_id, last_sync_at, situacoes_lidas_ate, sync_erro";
/** As colunas do vínculo que a rota lê. */
export const COLUNAS_DO_VINCULO_NA_TELA =
  "atlas_client_id, app_url, situacao, situacao_desde, situacao_lida_em, origem, casou_por, excluido_no_atlas_em";

export interface ConfigDaTela {
  api_url: string | null;
  atlas_tenant_id: string;
  last_sync_at: string | null;
  situacoes_lidas_ate: string | null;
  sync_erro: string | null;
}

export interface VinculoDaFicha {
  atlas_client_id: string;
  app_url: string | null;
  situacao: string | null;
  situacao_desde: string | null;
  situacao_lida_em: string | null;
  origem: string | null;
  casou_por: string | null;
  excluido_no_atlas_em: string | null;
}

/** A conexão guardada é deste ambiente? (nulo = o Atlas de verdade — `enderecos.ts`) */
export function conectadoNoAmbiente(config: Pick<ConfigDaTela, "api_url"> | null, ambiente: string | null): boolean {
  return config !== null && (config.api_url ?? null) === ambiente;
}

/** A resposta da rota. Conexão de OUTRO ambiente = desconectado (nada dela aparece). */
export function respostaDoContato(
  config: ConfigDaTela | null,
  vinculo: VinculoDaFicha | null,
  ambiente: string | null,
  agora: Date,
): AtlasDoContato {
  if (!config || !conectadoNoAmbiente(config, ambiente)) return { conectado: false, vinculo: null, erroDaLeitura: null };
  const erro = config.sync_erro ?? null;
  if (!vinculo) return { conectado: true, vinculo: null, erroDaLeitura: erro };
  const lida = lidaEm(vinculo.situacao_lida_em, config.situacoes_lidas_ate);
  return {
    conectado: true,
    erroDaLeitura: erro,
    vinculo: {
      atlasClientId: vinculo.atlas_client_id,
      appUrl: appUrlSegura(vinculo.app_url, vinculo.atlas_client_id),
      situacao: vinculo.situacao,
      situacaoDesde: vinculo.situacao_desde,
      origem: vinculo.origem,
      casouPor: vinculo.casou_por,
      excluidoEm: vinculo.excluido_no_atlas_em,
      lidaEm: lida,
      velha: leituraVelha(lida, erro, agora),
    },
  };
}

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A resposta da rota, conferida campo a campo; `null` = ilegível (a tela diz que falhou). */
export function lerAtlasDoContato(json: unknown): AtlasDoContato | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.conectado !== "boolean") return null;
  let vinculo: VinculoNaTela | null = null;
  if (o.vinculo && typeof o.vinculo === "object") {
    const v = o.vinculo as Record<string, unknown>;
    const atlasClientId = texto(v.atlasClientId);
    if (!atlasClientId) return null;
    vinculo = {
      atlasClientId,
      // Conferida de novo no navegador: é `href`.
      appUrl: appUrlSegura(texto(v.appUrl), atlasClientId),
      situacao: texto(v.situacao),
      situacaoDesde: texto(v.situacaoDesde),
      origem: texto(v.origem),
      casouPor: texto(v.casouPor),
      excluidoEm: texto(v.excluidoEm),
      lidaEm: texto(v.lidaEm),
      // Sem o booleano, "velha" — nunca afirmar leitura fresca sobre o que não se sabe.
      velha: v.velha !== false,
    };
  } else if (o.vinculo !== null && o.vinculo !== undefined) {
    return null;
  }
  return { conectado: o.conectado, vinculo: o.conectado ? vinculo : null, erroDaLeitura: texto(o.erroDaLeitura) };
}

/** O resultado da última leitura que voltou (`useAtlasDoContato`); `null` = nenhuma ainda. */
export type UltimaLeitura = "vinculo" | "sem_vinculo" | "falhou" | null;

/** O que o hook guarda: a última leitura que voltou, carimbada com o contato (`de`). */
export interface LeituraGuardada {
  de: string | null;
  dados: AtlasDoContato | null;
  falhou: boolean;
}

/**
 * Puro: o que `useAtlasDoContato` devolve para o contato do render ATUAL.
 * ⚠️ `dados`/`falhou` só do contato atual (o carimbo `{ de }`: entre a troca e
 * a resposta, o render tem o contato NOVO e a leitura do ANTERIOR — sem ele, a
 * faixa diria "rescindido no Atlas" na conversa de outro cliente); a
 * `ultimaLeitura` é a de QUALQUER contato, só para decidir a aba sem piscar.
 */
export function leituraParaOContato(
  estado: LeituraGuardada,
  contactId: string | null | undefined,
): { dados: AtlasDoContato | null; carregando: boolean; falhou: boolean; ultimaLeitura: UltimaLeitura } {
  const doContatoAtual = !!contactId && estado.de === contactId;
  return {
    dados: doContatoAtual ? estado.dados : null,
    carregando: !!contactId && !doContatoAtual,
    falhou: doContatoAtual && estado.falhou,
    ultimaLeitura: estado.de === null ? null : estado.falhou ? "falhou" : estado.dados?.vinculo ? "vinculo" : "sem_vinculo",
  };
}

/**
 * A aba Atlas aparece no PAINEL da conversa? (360 px sem quebra de linha: ela
 * some para quem não vincula quando a ficha não tem vínculo.)
 *
 * - Conta sem Atlas (`conectado === false`, da CONTA): nunca.
 * - Quem vincula (admin): sempre.
 * - Os outros: com vínculo — e com FALHA, para a falha aparecer como falha
 *   ("Tentar de novo"), nunca como aba sumida e painel de volta à Principal.
 * - ⚠️ Decide pela `ultimaLeitura`, que durante o `carregando` é a do contato
 *   ANTERIOR: pelo vínculo do contato atual (nulo durante a carga, carimbo
 *   `{ de }`), a aba sumia e voltava a cada troca entre duas fichas
 *   vinculadas, e os gatilhos `flex-1` da fileira se redistribuíam.
 */
export function abaAtlasNoPainel(e: { conectado: boolean | null; podeVincular: boolean; ultimaLeitura: UltimaLeitura }): boolean {
  if (e.conectado === false) return false;
  if (e.podeVincular) return true;
  return e.ultimaLeitura === "vinculo" || e.ultimaLeitura === "falhou";
}

/** A situação que a tela sabe traduzir (`em_negociacao` vale `ativo`); outra = `null` (texto de reserva). */
export function situacaoConhecida(situacao: string | null | undefined): SituacaoDoAtlas | null {
  const s = situacaoComparavel(situacao);
  return (SITUACOES_DO_ATLAS as readonly string[]).includes(s) ? (s as SituacaoDoAtlas) : null;
}
