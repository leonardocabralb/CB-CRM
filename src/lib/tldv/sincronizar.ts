import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";

import { criarClienteTldv, TldvError, type ClienteTldv } from "./cliente";
import { janelaDeSync } from "./janela";
import type { ReuniaoDoTldv } from "./leitura";
import { textoDaTranscricao } from "./texto";
import { contatoParaVincular, emailsDeFora } from "./vinculo";

/**
 * A sincronização de UMA conta com o tl;dv, em três passos:
 *
 * 1. LISTAR as reuniões da janela (7 dias; 30 na primeira) e gravar cada
 *    uma por `upsert` em `(account_id, tldv_meeting_id)` — só os METADADOS
 *    (nome, data, duração, participantes). Status, cliente e transcrição
 *    NÃO entram no upsert: reunião já conhecida mantém o que tem.
 * 2. VINCULAR pelo e-mail as que ainda não têm cliente e nunca tiveram
 *    (`vinculo_origem IS NULL`) — a desvinculada à mão fica desvinculada.
 * 3. BUSCAR a transcrição das `pendente`, até `TRANSCRICOES_POR_CICLO` por
 *    ciclo e dentro do prazo. Ainda não pronta = conta uma tentativa; depois
 *    de `MAX_TENTATIVAS` (~3h a cada 15 min) vira `sem_transcricao` — o
 *    botão "Buscar de novo" da tela zera e recomeça.
 *
 * Roda com o client de SERVICE ROLE (a config é fechada para o navegador e a
 * escrita nas reuniões é da rota). Chamada pelo cron, pelo "Sincronizar
 * agora", em `after()` logo depois de conectar, e — só o passo de UMA
 * reunião, `importarReuniaoDoTldv` — pelo webhook e pelo "colar link".
 * Falha do tl;dv vira `status = 'erro'` com o CÓDIGO em `last_error`; a
 * mensagem crua vai só ao log, já sem a chave (`semSegredo`).
 */

export const MAX_TENTATIVAS = 12;
export const TRANSCRICOES_POR_CICLO = 10;
const PAGINAS_MAX = 20;
const PRAZO_PADRAO_MS = 60_000;

type FabricaDeCliente = (chave: string) => ClienteTldv;

export interface OpcoesDeSync {
  agora?: Date;
  primeira?: boolean;
  cliente?: FabricaDeCliente;
  /** Instante (epoch ms) a partir do qual nada novo é começado. */
  prazoMs?: number;
}

export type ResultadoDaSync =
  | { ok: true; reunioes: number; transcritas: number; vinculadas: number; adiadas: number }
  | { ok: false; codigo: string };

export type ResultadoDaImportacao =
  | { ok: true; id: string; status: string; contactId: string | null }
  | { ok: false; codigo: string };

interface LinhaGravada {
  id: string;
  status: string;
  contact_id: string | null;
  vinculo_origem: string | null;
  tentativas: number;
}

type ConfigLida = { ok: true; chave: string; primeira: boolean } | { ok: false; codigo: string };

async function lerConfig(admin: SupabaseClient, accountId: string): Promise<ConfigLida> {
  const { data, error } = await admin.from("cb_tldv_config").select("api_key, last_sync_at").eq("account_id", accountId).maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  try {
    return { ok: true, chave: decrypt(data.api_key as string), primeira: !data.last_sync_at };
  } catch {
    await marcarErro(admin, accountId, "chave_ilegivel");
    return { ok: false, codigo: "chave_ilegivel" };
  }
}

async function marcarErro(admin: SupabaseClient, accountId: string, codigo: string): Promise<void> {
  await admin
    .from("cb_tldv_config")
    .update({ status: "erro", last_error: codigo, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);
}

/** Upsert dos METADADOS; devolve a linha como ficou (status/cliente preservados). */
async function gravarReuniao(admin: SupabaseClient, accountId: string, r: ReuniaoDoTldv, agora: Date): Promise<LinhaGravada> {
  const { data, error } = await admin
    .from("cb_reunioes_transcritas")
    .upsert(
      {
        account_id: accountId,
        origem: "tldv",
        tldv_meeting_id: r.id,
        titulo: r.nome.slice(0, 200),
        realizada_em: r.realizadaEm,
        duracao_seg: r.duracaoSeg,
        url: r.url,
        organizador_nome: r.organizador?.nome || null,
        organizador_email: r.organizador?.email || null,
        participantes: r.convidados,
        updated_at: agora.toISOString(),
      },
      { onConflict: "account_id,tldv_meeting_id" },
    )
    .select("id, status, contact_id, vinculo_origem, tentativas")
    .single();
  if (error || !data) throw new Error(`gravar reunião ${r.id}: ${error?.message ?? "sem linha"}`);
  return data as LinhaGravada;
}

async function emailsDaEquipe(admin: SupabaseClient, accountId: string): Promise<string[]> {
  const { data } = await admin.from("profiles").select("email").eq("account_id", accountId);
  return ((data ?? []) as { email: string | null }[]).map((p) => p.email ?? "").filter((e) => e !== "");
}

/** `foo@bar.com` → `"foo@bar.com"` escapado para o `.or()` do PostgREST (LIKE + aspas). */
function paraIlike(v: string): string {
  const like = v.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `"${like.replace(/(["\\])/g, "\\$1")}"`;
}

/**
 * Vincula pelo e-mail quando dá para vincular sem dúvida — primeiro pelo
 * e-mail da FICHA, depois pelo e-mail do AGENDAMENTO do Calendly que já
 * resolveu o contato. O UPDATE é cercado por `contact_id IS NULL`: entre a
 * leitura e a escrita alguém pode ter vinculado à mão, e a regra não
 * sobrescreve gente.
 */
async function vincularPorEmail(
  admin: SupabaseClient,
  accountId: string,
  linhaId: string,
  reuniao: ReuniaoDoTldv,
  equipe: readonly string[],
  agora: Date,
): Promise<boolean> {
  const emails = emailsDeFora(reuniao, equipe);
  if (emails.length === 0) return false;
  const porEmail = emails.map((e) => `email.ilike.${paraIlike(e)}`).join(",");
  const { data: achados, error } = await admin.from("contacts").select("id").eq("account_id", accountId).or(porEmail);
  if (error || !achados) return false;
  let candidatos = achados as { id: string }[];
  if (candidatos.length === 0) {
    // ⚠️ SEGUNDA FONTE: o agendamento do Calendly (977). Medido na primeira
    // conexão real (09/09/2026): o convidado chega do tl;dv com o nome
    // VAZIO e só o e-mail, e os contatos deste CRM vieram do WhatsApp —
    // quase nenhum tem e-mail na ficha. Mas a reunião nasceu de um
    // agendamento no Calendly, que guardou o MESMO e-mail e já resolveu o
    // contato pelo telefone. Sem esta ponte o vínculo automático quase
    // nunca acontecia. `contact_id` nulo fica de fora (agendamento sem
    // ficha não liga ninguém).
    const { data: agendamentos, error: erroAgendamentos } = await admin
      .from("cb_calendly_eventos")
      .select("contact_id")
      .eq("account_id", accountId)
      .not("contact_id", "is", null)
      .or(porEmail);
    if (erroAgendamentos || !agendamentos) return false;
    candidatos = (agendamentos as { contact_id: string }[]).map((a) => ({ id: a.contact_id }));
  }
  const contactId = contatoParaVincular(candidatos);
  if (!contactId) return false;
  const { data: atualizada } = await admin
    .from("cb_reunioes_transcritas")
    .update({ contact_id: contactId, vinculo_origem: "email", vinculado_em: agora.toISOString(), updated_at: agora.toISOString() })
    .eq("id", linhaId)
    .eq("account_id", accountId)
    .is("contact_id", null)
    .select("id");
  return (atualizada?.length ?? 0) > 0;
}

/**
 * Busca a transcrição (e as notas) de UMA reunião e grava o desfecho.
 * Devolve o status que ficou. Lança `TldvError` quando o problema é da
 * CONTA (chave inválida, limite) — aí o ciclo inteiro para.
 */
async function buscarTranscricao(
  admin: SupabaseClient,
  cliente: ClienteTldv,
  linha: { id: string; tldv_meeting_id: string; tentativas: number },
  agora: Date,
): Promise<string> {
  const carimbo = agora.toISOString();
  try {
    const frases = await cliente.transcricao(linha.tldv_meeting_id);
    if (!frases) {
      const tentativas = linha.tentativas + 1;
      const status = tentativas >= MAX_TENTATIVAS ? "sem_transcricao" : "pendente";
      await admin.from("cb_reunioes_transcritas").update({ tentativas, status, erro: null, updated_at: carimbo }).eq("id", linha.id);
      return status;
    }
    // As notas são bônus: falha nelas não derruba a transcrição.
    const notas = await cliente.notas(linha.tldv_meeting_id).catch(() => null);
    const notasTexto =
      notas?.markdown ?? (notas && notas.topicos.length > 0 ? notas.topicos.map((t) => `## ${t.titulo}\n${t.resumo}`).join("\n\n") : null);
    const { error } = await admin
      .from("cb_reunioes_transcritas")
      .update({
        status: "pronta",
        texto: textoDaTranscricao(frases),
        segmentos: frases,
        notas: notasTexto,
        erro: null,
        tentativas: linha.tentativas + 1,
        updated_at: carimbo,
      })
      .eq("id", linha.id);
    if (error) throw new Error(`gravar transcrição ${linha.id}: ${error.message}`);
    return "pronta";
  } catch (e) {
    if (e instanceof TldvError) {
      if (e.codigo === "chave_invalida" || e.codigo === "limite" || e.codigo === "rede") throw e;
      // 403 é do PLANO de quem organizou a reunião: insistir não muda.
      const tentativas = linha.tentativas + 1;
      const status = e.codigo === "sem_permissao" || tentativas >= MAX_TENTATIVAS ? "falhou" : "pendente";
      await admin.from("cb_reunioes_transcritas").update({ tentativas, status, erro: e.codigo, updated_at: carimbo }).eq("id", linha.id);
      return status;
    }
    throw e;
  }
}

export async function sincronizarTldv(admin: SupabaseClient, accountId: string, opcoes: OpcoesDeSync = {}): Promise<ResultadoDaSync> {
  const agora = opcoes.agora ?? new Date();
  // ⚠️ O prazo é medido pelo relógio REAL (`Date.now()`), não por `agora`:
  // `agora` é o carimbo das escritas e pode ser injetado (testes, replay);
  // o prazo é "quanto tempo esta chamada ainda pode gastar".
  const prazoMs = opcoes.prazoMs ?? Date.now() + PRAZO_PADRAO_MS;
  const config = await lerConfig(admin, accountId);
  if (!config.ok) return { ok: false, codigo: config.codigo };
  // ⚠️ A TENTATIVA é carimbada ANTES de qualquer trabalho, dê certo ou
  // errado: é por esta coluna que o cron ordena as contas, e é o que faz a
  // conta deixada para trás num ciclo vir para a frente no seguinte
  // (achado do Codex no PR #163). Carimbar só no sucesso deixaria a conta
  // que falha na frente para sempre, comendo o orçamento das outras.
  await admin
    .from("cb_tldv_config")
    .update({ last_sync_attempt_at: agora.toISOString() })
    .eq("account_id", accountId);
  const cliente = (opcoes.cliente ?? criarClienteTldv)(config.chave);
  const janela = janelaDeSync(agora, opcoes.primeira ?? config.primeira);

  try {
    // 1) listar e gravar
    const gravadas: { linha: LinhaGravada; reuniao: ReuniaoDoTldv }[] = [];
    for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
      const p = await cliente.listarReunioes({ de: janela.de, ate: janela.ate, pagina });
      for (const r of p.reunioes) gravadas.push({ linha: await gravarReuniao(admin, accountId, r, agora), reuniao: r });
      if (pagina >= p.paginas || p.reunioes.length === 0) break;
    }

    // 2) vincular pelo e-mail
    let vinculadas = 0;
    const semCliente = gravadas.filter((g) => g.linha.contact_id === null && g.linha.vinculo_origem === null);
    if (semCliente.length > 0) {
      const equipe = await emailsDaEquipe(admin, accountId);
      for (const g of semCliente) {
        if (await vincularPorEmail(admin, accountId, g.linha.id, g.reuniao, equipe, agora)) vinculadas++;
      }
    }

    // 3) transcrições pendentes (as mais recentes primeiro)
    const { data: pendentes, error: erroPendentes } = await admin
      .from("cb_reunioes_transcritas")
      .select("id, tldv_meeting_id, tentativas")
      .eq("account_id", accountId)
      .eq("origem", "tldv")
      .eq("status", "pendente")
      .order("realizada_em", { ascending: false })
      .limit(TRANSCRICOES_POR_CICLO);
    if (erroPendentes) throw new Error(`pendentes: ${erroPendentes.message}`);
    let transcritas = 0;
    let adiadas = 0;
    for (const linha of (pendentes ?? []) as { id: string; tldv_meeting_id: string; tentativas: number }[]) {
      if (Date.now() > prazoMs) {
        adiadas++;
        continue;
      }
      if ((await buscarTranscricao(admin, cliente, linha, agora)) === "pronta") transcritas++;
    }

    await admin
      .from("cb_tldv_config")
      .update({ status: "conectado", last_sync_at: agora.toISOString(), last_error: null, updated_at: agora.toISOString() })
      .eq("account_id", accountId);
    return { ok: true, reunioes: gravadas.length, transcritas, vinculadas, adiadas };
  } catch (e) {
    const codigo = e instanceof TldvError ? e.codigo : "db_error";
    console.error(`[tldv] sincronização da conta ${accountId} falhou (${codigo}):`, e instanceof Error ? e.message : e);
    await marcarErro(admin, accountId, codigo);
    return { ok: false, codigo };
  }
}

/**
 * UMA reunião, agora: busca no tl;dv pelo id, grava, vincula pelo e-mail e
 * tenta a transcrição. É o caminho do webhook (`MeetingReady`/
 * `TranscriptReady`) e do "colar link do tl;dv" na ficha do cliente.
 * ⚠️ Não mexe em `last_sync_at`: isso é da varredura.
 */
export async function importarReuniaoDoTldv(
  admin: SupabaseClient,
  accountId: string,
  meetingId: string,
  opcoes: Pick<OpcoesDeSync, "agora" | "cliente"> = {},
): Promise<ResultadoDaImportacao> {
  const agora = opcoes.agora ?? new Date();
  const config = await lerConfig(admin, accountId);
  if (!config.ok) return { ok: false, codigo: config.codigo };
  const cliente = (opcoes.cliente ?? criarClienteTldv)(config.chave);
  try {
    const reuniao = await cliente.reuniao(meetingId);
    const linha = await gravarReuniao(admin, accountId, reuniao, agora);
    let contactId = linha.contact_id;
    if (contactId === null && linha.vinculo_origem === null) {
      const equipe = await emailsDaEquipe(admin, accountId);
      if (await vincularPorEmail(admin, accountId, linha.id, reuniao, equipe, agora)) {
        const { data } = await admin.from("cb_reunioes_transcritas").select("contact_id").eq("id", linha.id).maybeSingle();
        contactId = (data?.contact_id as string | null) ?? null;
      }
    }
    let status = linha.status;
    if (status !== "pronta") {
      status = await buscarTranscricao(admin, cliente, { id: linha.id, tldv_meeting_id: meetingId, tentativas: linha.tentativas }, agora);
    }
    return { ok: true, id: linha.id, status, contactId };
  } catch (e) {
    const codigo = e instanceof TldvError ? e.codigo : "db_error";
    console.error(`[tldv] importação da reunião ${meetingId} (conta ${accountId}) falhou (${codigo}):`, e instanceof Error ? e.message : e);
    if (codigo === "chave_invalida") await marcarErro(admin, accountId, codigo);
    return { ok: false, codigo };
  }
}
