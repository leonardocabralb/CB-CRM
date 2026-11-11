// ============================================================
// A transcrição da ligação pelo CRM (4d, `docs/PLANO-ligar-pelo-crm.md` §8.5
// e §8.16): os dois lados da gravação viram um diálogo com horários e um
// resumo (D11), pelo provedor da conta (D14: Gemini, senão OpenAI — a mesma
// chave e a mesma régua das notas de voz, `escolherLeitor`).
//
// O contrato é o da transcrição de áudio (`transcrever.ts`):
//  - o CADEADO `UPDATE … RETURNING` com o teto de tentativas no WHERE e o
//    recolhimento da travada; toda escrita depois dele leva a cerca
//    (`transcricao_desde` = o carimbo do próprio cadeado);
//  - SEM CHAVE não grava estado (a ligação é tentada de novo quando houver,
//    dentro da janela do laço); erro de leitura da chave é passageiro;
//  - o custo vai a `ai_usage_log` (modo `transcricao`) ANTES de julgar a
//    resposta: o áudio de entrada já foi cobrado.
// Diferenças, com o porquê:
//  - a 3ª falha vira `recusada` na hora (a faixa nunca fica em
//    "Transcrevendo…" para sempre — `falhou` na faixa quer dizer "vai repetir");
//  - o resumo que falha não derruba o diálogo: grava sem resumo.
//
// Quem chama: a rota da gravação (`after()`, quando o arquivo que chegou
// completa os dois lados) e o laço lento (`retomarTranscricoes`), que repete
// o que falhou. Os dois lados saem do Storage quando o diálogo fica pronto;
// o estéreo fica (é o que se ouve) até a poda dos 180 dias.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { geminiEndpoint } from '@/lib/ai/providers/gemini';
import { toGeminiSchema } from '@/lib/ai/structured';
import type { AiProvider, AiUsage } from '@/lib/ai/types';
import { logAiUsage } from '@/lib/ai/usage';
import { escolherLeitor } from '@/lib/transcricao/escolher-leitor';
import {
  erroDoProvedor,
  lerRespostaDeLeitura,
  lerRespostaDeTranscricaoOpenAi,
  MODELO_DE_LEITURA,
  ORDEM_DA_TRANSCRICAO,
  URL_DA_OPENAI_RESPONSES,
  URL_DA_OPENAI_TRANSCRICAO,
} from '@/lib/transcricao/leitores';
import { MODELO_TRANSCRICAO } from '@/lib/transcricao/transcrever';

import {
  dialogoEmTexto,
  ESQUEMA_DO_LADO,
  INSTRUCAO_DO_LADO,
  INSTRUCAO_DO_RESUMO,
  intercalar,
  lerTrechosDaOpenAi,
  lerTrechosDoGemini,
  limparResumo,
  MODELO_DA_LIGACAO_OPENAI,
  type Trecho,
  type TrechoDoLado,
} from './dialogo';
import { BUCKET_DAS_GRAVACOES, caminhoDaGravacao, sincronizarFaixa } from './pelo-crm';

export const TENTATIVAS_DA_TRANSCRICAO = 3;
/** Travada (o deploy no meio) volta ao cadeado depois disto. */
const TRAVADA_MIN = 15;
/** Cada chamada a um lado: 30 min de fala dão ~3,6 MB de Opus. */
const PRAZO_DO_LADO_MS = 180_000;
const PRAZO_DO_RESUMO_MS = 60_000;
/** O raciocínio do Gemini conta dentro do teto (medido na leitura: 24.576). */
const TETO_DE_SAIDA_DO_LADO = 32_768;
const TETO_DE_SAIDA_DO_RESUMO = 8_192;
/** Os lados que não chegaram até aqui (contado do FIM da ligação) não vêm mais: fica sem transcrição. */
const ESPERA_DOS_LADOS_MS = 60 * 60_000;
/** O laço só tenta ligação desta idade para cá (a sem chave não fica para sempre). */
export const JANELA_DA_TRANSCRICAO_DIAS = 7;
/** O laço transcreve no máximo isto por ciclo, e só com o prazo de um lado sobrando. */
const POR_CICLO = 3;

const ROTULOS_DO_RESUMO = { cliente: 'Cliente', atendente: 'Atendente' } as const;

export type ResultadoDaTranscricao =
  /** Transcrita agora. */
  | 'pronta'
  /** Nada a fazer: sem atendimento, já decidida, expirada ou desconhecida. */
  | 'nada'
  /** Os dois lados ainda não chegaram ao bucket. */
  | 'cedo'
  /** Sem chave do Gemini nem da OpenAI (ou ilegível): nada gravado. */
  | 'sem_chave'
  /** Outro processo está transcrevendo (ou ganhou a cerca). */
  | 'ocupada'
  /** Passageiro: gravado `falhou` (ou nada gravado); o laço repete. */
  | 'falhou'
  /** Terminal: a ligação fica sem transcrição. */
  | 'recusada';

type LinhaDaTranscricao = {
  id: string;
  account_id: string;
  conversation_id: string | null;
  pelo_crm: boolean;
  atendida_pelo_crm_em: string | null;
  desfecho_em: string | null;
  gravacao_expirada_em: string | null;
  transcricao_status: string | null;
  transcricao_tentativas: number;
};

const COLUNAS =
  'id, account_id, conversation_id, pelo_crm, atendida_pelo_crm_em, desfecho_em, gravacao_expirada_em, transcricao_status, transcricao_tentativas';

// ------------------------------------------------------------
// Os provedores
// ------------------------------------------------------------

type LadoTranscrito = {
  trechos: TrechoDoLado[] | null;
  /** A resposta parou no teto (o lado longo demais): terminal. */
  cortado: boolean;
  /** Falha passageira ou resposta fora da forma: o motivo. */
  erro: string | null;
  usage: AiUsage | null;
  modelo: string;
};

async function transcreverLado(provedor: AiProvider, chave: string, audio: Buffer): Promise<LadoTranscrito> {
  if (provedor === 'gemini') {
    const modelo = MODELO_TRANSCRICAO;
    const r = await fetch(geminiEndpoint(modelo), {
      method: 'POST',
      // ⚠️ A chave no cabeçalho, nunca `?key=` na URL (vaza em log de proxy).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: INSTRUCAO_DO_LADO }, { inlineData: { mimeType: 'audio/ogg', data: audio.toString('base64') } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: TETO_DE_SAIDA_DO_LADO,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(ESQUEMA_DO_LADO),
        },
      }),
      signal: AbortSignal.timeout(PRAZO_DO_LADO_MS),
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      return { trechos: null, cortado: false, erro: erroDoProvedor(provedor, r.status, corpo, chave), usage: null, modelo };
    }
    const lida = lerRespostaDeLeitura(provedor, await r.json().catch(() => null));
    if (lida.cortado) return { trechos: null, cortado: true, erro: null, usage: lida.usage, modelo };
    if (lida.bloqueio) return { trechos: null, cortado: false, erro: lida.bloqueio, usage: lida.usage, modelo };
    const trechos = lerTrechosDoGemini(lida.texto);
    return {
      trechos,
      cortado: false,
      erro: trechos ? null : 'a resposta não veio na forma pedida',
      usage: lida.usage,
      modelo,
    };
  }
  // OpenAI: só o `whisper-1` dá os trechos com horário (`dialogo.ts`).
  const modelo = MODELO_DA_LIGACAO_OPENAI;
  const form = new FormData();
  // Cópia num `Uint8Array` próprio: o `Buffer` do Node pode apontar para um
  // `SharedArrayBuffer`, que o `Blob` não aceita.
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'lado.ogg');
  form.append('model', modelo);
  form.append('language', 'pt');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const r = await fetch(URL_DA_OPENAI_TRANSCRICAO, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}` },
    body: form,
    signal: AbortSignal.timeout(PRAZO_DO_LADO_MS),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    return { trechos: null, cortado: false, erro: erroDoProvedor(provedor, r.status, corpo, chave), usage: null, modelo };
  }
  const corpo = (await r.json().catch(() => null)) as unknown;
  const trechos = lerTrechosDaOpenAi(corpo);
  return {
    trechos,
    cortado: false,
    erro: trechos ? null : 'a resposta não veio na forma pedida',
    // O `whisper-1` cobra por duração: sem token, a linha de uso não entra.
    usage: lerRespostaDeTranscricaoOpenAi(corpo).usage,
    modelo,
  };
}

/** O resumo pelo mesmo provedor. Falha = `resumo: null` (o diálogo grava assim mesmo). Nunca lança. */
async function resumir(
  provedor: AiProvider,
  chave: string,
  dialogo: string,
): Promise<{ resumo: string | null; usage: AiUsage | null; modelo: string }> {
  const modelo = provedor === 'gemini' ? MODELO_TRANSCRICAO : MODELO_DE_LEITURA[provedor];
  const texto = `${INSTRUCAO_DO_RESUMO}\n\n${dialogo}`;
  try {
    const r =
      provedor === 'gemini'
        ? await fetch(geminiEndpoint(modelo), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: texto }] }],
              generationConfig: { temperature: 0, maxOutputTokens: TETO_DE_SAIDA_DO_RESUMO },
            }),
            signal: AbortSignal.timeout(PRAZO_DO_RESUMO_MS),
          })
        : await fetch(URL_DA_OPENAI_RESPONSES, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
            // ⚠️ `store: false`: por padrão a Responses GUARDA a resposta, e isto é conversa de cliente.
            body: JSON.stringify({
              model: modelo,
              store: false,
              max_output_tokens: TETO_DE_SAIDA_DO_RESUMO,
              input: [{ role: 'user', content: [{ type: 'input_text', text: texto }] }],
            }),
            signal: AbortSignal.timeout(PRAZO_DO_RESUMO_MS),
          });
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      console.error('[ligacoes] resumo:', erroDoProvedor(provedor, r.status, corpo, chave));
      return { resumo: null, usage: null, modelo };
    }
    const lida = lerRespostaDeLeitura(provedor, await r.json().catch(() => null));
    if (lida.bloqueio || lida.cortado) {
      console.error('[ligacoes] resumo não entregue:', lida.bloqueio ?? 'cortado no teto');
      return { resumo: null, usage: lida.usage, modelo };
    }
    return { resumo: limparResumo(lida.texto), usage: lida.usage, modelo };
  } catch (err) {
    console.error('[ligacoes] resumo:', err instanceof Error ? err.message : String(err));
    return { resumo: null, usage: null, modelo };
  }
}

// ------------------------------------------------------------
// Estados com cerca
// ------------------------------------------------------------

/** Falha depois do cadeado: `falhou` (o laço repete) ou, na última tentativa, `recusada`. */
async function falhar(
  db: SupabaseClient,
  linha: LinhaDaTranscricao,
  claimIso: string,
  motivo: string,
): Promise<ResultadoDaTranscricao> {
  const ultima = linha.transcricao_tentativas + 1 >= TENTATIVAS_DA_TRANSCRICAO;
  const status = ultima ? 'recusada' : 'falhou';
  const { data, error } = await db
    .from('cb_ligacoes')
    .update({
      transcricao_status: status,
      transcricao_erro: (ultima ? `tentativas esgotadas: ${motivo}` : motivo).slice(0, 300),
      transcricao_desde: null,
    })
    .eq('id', linha.id)
    .eq('transcricao_status', 'transcrevendo')
    .eq('transcricao_desde', claimIso)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[ligacoes] gravar a falha da transcrição falhou:', linha.id, error.message);
    return 'falhou';
  }
  if (!data) return 'ocupada';
  await sincronizarFaixa(db, linha.id);
  return ultima ? 'recusada' : 'falhou';
}

/** Terminal: com a cerca quando vem de um cadeado nosso; sem, quando é decisão prévia. */
async function recusar(
  db: SupabaseClient,
  linha: LinhaDaTranscricao,
  motivo: string,
  claimIso: string | null,
): Promise<ResultadoDaTranscricao> {
  let consulta = db
    .from('cb_ligacoes')
    .update({ transcricao_status: 'recusada', transcricao_erro: motivo.slice(0, 300), transcricao_desde: null })
    .eq('id', linha.id);
  consulta = claimIso
    ? consulta.eq('transcricao_status', 'transcrevendo').eq('transcricao_desde', claimIso)
    : consulta.or('transcricao_status.is.null,transcricao_status.eq.falhou');
  const { data, error } = await consulta.select('id').maybeSingle();
  if (error) {
    console.error('[ligacoes] recusar a transcrição falhou:', linha.id, error.message);
    return 'falhou';
  }
  if (!data) return 'ocupada';
  await sincronizarFaixa(db, linha.id);
  return 'recusada';
}

// ------------------------------------------------------------
// A transcrição
// ------------------------------------------------------------

async function baixar(db: SupabaseClient, caminho: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(BUCKET_DAS_GRAVACOES).download(caminho);
  if (error || !data) throw new Error(`download de ${caminho.split('/').pop()} falhou: ${error?.message ?? 'vazio'}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Transcreve a ligação, se for a hora. Idempotente e guardada pelo cadeado. Nunca lança. */
export async function transcreverLigacao(db: SupabaseClient, ligacaoId: string): Promise<ResultadoDaTranscricao> {
  const { data, error } = await db.from('cb_ligacoes').select(COLUNAS).eq('id', ligacaoId).maybeSingle();
  if (error) return 'falhou';
  const linha = data as LinhaDaTranscricao | null;
  if (!linha || !linha.pelo_crm || !linha.atendida_pelo_crm_em || linha.gravacao_expirada_em) return 'nada';
  if (linha.transcricao_status === 'pronta' || linha.transcricao_status === 'recusada') return 'nada';

  // Os dois lados no bucket (a máquina manda estéreo, cliente e atendente em
  // pedidos separados; o que falhou volta 5 min depois, fora de ordem).
  const caminhoDoCliente = caminhoDaGravacao(linha.account_id, linha.id, 'cliente.ogg');
  const caminhoDoAtendente = caminhoDaGravacao(linha.account_id, linha.id, 'atendente.ogg');
  const pasta = caminhoDoCliente.slice(0, caminhoDoCliente.lastIndexOf('/'));
  let nomes: Set<string>;
  try {
    // O Storage fora do ar (rede, 5xx) LANÇA; ausente é lista vazia.
    const { data: arquivos, error: erroDaLista } = await db.storage.from(BUCKET_DAS_GRAVACOES).list(pasta);
    if (erroDaLista) return 'falhou';
    nomes = new Set((arquivos ?? []).map((a) => a.name));
  } catch {
    return 'falhou';
  }
  if (!nomes.has('cliente.ogg') || !nomes.has('atendente.ogg')) {
    // Do FIM: a ligação de 30 min (D13) não pode gastar a espera inteira falando.
    if (Date.now() - Date.parse(linha.desfecho_em ?? linha.atendida_pelo_crm_em) > ESPERA_DOS_LADOS_MS) {
      return recusar(db, linha, 'a gravação não trouxe os dois lados', null);
    }
    return 'cedo';
  }

  // A chave ANTES do cadeado: sem ela, nada se grava.
  const escolha = await escolherLeitor(linha.account_id, ORDEM_DA_TRANSCRICAO);
  if (!escolha.ok) return escolha.motivo === 'erro' ? 'falhou' : 'sem_chave';
  const { provedor, chave } = escolha;

  const claimIso = new Date().toISOString();
  const corte = new Date(Date.now() - TRAVADA_MIN * 60_000).toISOString();
  const { data: claim, error: erroDoCadeado } = await db
    .from('cb_ligacoes')
    .update({
      transcricao_status: 'transcrevendo',
      transcricao_desde: claimIso,
      transcricao_tentativas: linha.transcricao_tentativas + 1,
      transcricao_erro: null,
    })
    .eq('id', linha.id)
    .is('gravacao_expirada_em', null)
    .lt('transcricao_tentativas', TENTATIVAS_DA_TRANSCRICAO)
    // O incremento é ler-então-escrever: amarrado ao valor LIDO, um cadeado
    // concorrente não faz o contador regredir.
    .eq('transcricao_tentativas', linha.transcricao_tentativas)
    .or(`transcricao_status.is.null,transcricao_status.eq.falhou,and(transcricao_status.eq.transcrevendo,transcricao_desde.lt.${corte})`)
    .select('id')
    .maybeSingle();
  if (erroDoCadeado) return 'falhou';
  if (!claim) {
    // A travada da última tentativa (o processo morreu) não volta ao cadeado:
    // sem esta saída, a faixa ficava em "Transcrevendo…" para sempre.
    if (linha.transcricao_tentativas >= TENTATIVAS_DA_TRANSCRICAO) {
      const { data: atual } = await db.from('cb_ligacoes').select('transcricao_status, transcricao_desde').eq('id', linha.id).maybeSingle();
      // Datas como NÚMERO: o PostgREST devolve `+00:00` e micros, o JS `Z`.
      const desde = Date.parse((atual?.transcricao_desde as string | null) ?? '');
      if (atual?.transcricao_status === 'transcrevendo' && desde < Date.parse(corte)) {
        return recusar(db, linha, 'tentativas esgotadas', atual.transcricao_desde as string);
      }
    }
    return 'ocupada';
  }
  await sincronizarFaixa(db, linha.id);

  try {
    const [audioDoCliente, audioDoAtendente] = await Promise.all([baixar(db, caminhoDoCliente), baixar(db, caminhoDoAtendente)]);
    // `allSettled`: o lado que estourou o prazo não leva junto o custo do
    // outro, que já foi cobrado.
    const lados = await Promise.allSettled([
      transcreverLado(provedor, chave, audioDoCliente),
      transcreverLado(provedor, chave, audioDoAtendente),
    ]);
    for (const lado of lados) {
      if (lado.status !== 'fulfilled') continue;
      void logAiUsage(db, {
        accountId: linha.account_id,
        conversationId: linha.conversation_id,
        mode: 'transcricao',
        provider: provedor,
        model: lado.value.modelo,
        usage: lado.value.usage,
      });
    }
    const falhou = lados.find((l) => l.status === 'rejected');
    if (falhou) throw falhou.reason;
    const [cliente, atendente] = lados.map((l) => (l as PromiseFulfilledResult<LadoTranscrito>).value);
    // Cortado no teto é determinístico (temperatura 0): repetir paga o mesmo.
    if (cliente.cortado || atendente.cortado) return recusar(db, linha, 'ligação longa demais para transcrever', claimIso);
    if (!cliente.trechos || !atendente.trechos) {
      return falhar(db, linha, claimIso, cliente.erro ?? atendente.erro ?? 'resposta vazia');
    }

    const trechos: Trecho[] = intercalar(cliente.trechos, atendente.trechos);
    let resumo: string | null = null;
    if (trechos.length > 0) {
      const r = await resumir(provedor, chave, dialogoEmTexto(trechos, ROTULOS_DO_RESUMO));
      void logAiUsage(db, {
        accountId: linha.account_id,
        conversationId: linha.conversation_id,
        mode: 'transcricao',
        provider: provedor,
        model: r.modelo,
        usage: r.usage,
      });
      resumo = r.resumo;
    }

    const { data: gravado, error: erroDaGravacao } = await db
      .from('cb_ligacoes')
      .update({
        transcricao: trechos,
        resumo,
        transcricao_status: 'pronta',
        transcricao_em: new Date().toISOString(),
        transcricao_erro: null,
        transcricao_desde: null,
      })
      .eq('id', linha.id)
      .eq('transcricao_status', 'transcrevendo')
      .eq('transcricao_desde', claimIso)
      .select('id')
      .maybeSingle();
    if (erroDaGravacao) return falhar(db, linha, claimIso, `gravar a transcrição: ${erroDaGravacao.message}`);
    if (!gravado) return 'ocupada';
    await sincronizarFaixa(db, linha.id);

    // Os dois lados só serviam à transcrição: saem (fica o estéreo, que se ouve).
    const { error: erroDaLimpeza } = await db.storage.from(BUCKET_DAS_GRAVACOES).remove([caminhoDoCliente, caminhoDoAtendente]);
    if (erroDaLimpeza) console.error('[ligacoes] apagar os lados da gravação falhou:', linha.id, erroDaLimpeza.message);
    return 'pronta';
  } catch (err) {
    const motivo =
      err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
        ? 'tempo esgotado'
        : err instanceof Error
          ? err.message
          : 'erro desconhecido';
    return falhar(db, linha, claimIso, motivo);
  }
}

// ------------------------------------------------------------
// O laço lento
// ------------------------------------------------------------

/**
 * Repete o que ficou para trás: a ligação atendida pelo CRM, dos últimos
 * `JANELA_DA_TRANSCRICAO_DIAS`, que ainda não tem desfecho de transcrição
 * (nunca tentada — o `after()` perdeu —, `falhou` ou travada). Até
 * `POR_CICLO`, e só com o prazo de um lado inteiro sobrando. Nunca lança.
 */
export async function retomarTranscricoes(db: SupabaseClient, prazo: number): Promise<void> {
  try {
    await retomar(db, prazo);
  } catch (err) {
    console.error('[ligacoes] transcrições pendentes pararam:', err instanceof Error ? err.message : String(err));
  }
}

async function retomar(db: SupabaseClient, prazo: number): Promise<void> {
  const desde = new Date(Date.now() - JANELA_DA_TRANSCRICAO_DIAS * 86_400_000).toISOString();

  // Passada a janela, a que ficou sem desfecho (`falhou` sem chave para
  // repetir, ou travada) vira `recusada`: senão a faixa diria
  // "Transcrevendo…" até a poda dos 180 dias.
  const { data: velhas, error: erroDasVelhas } = await db
    .from('cb_ligacoes')
    .select('id')
    .eq('pelo_crm', true)
    .is('gravacao_expirada_em', null)
    .lt('criada_em', desde)
    .in('transcricao_status', ['falhou', 'transcrevendo'])
    .limit(25);
  if (erroDasVelhas) console.error('[ligacoes] transcrições vencidas: leitura falhou:', erroDasVelhas.message);
  for (const v of (velhas ?? []) as { id: string }[]) {
    const { data: encerrada, error } = await db
      .from('cb_ligacoes')
      .update({
        transcricao_status: 'recusada',
        transcricao_erro: `não transcrita em ${JANELA_DA_TRANSCRICAO_DIAS} dias`,
        transcricao_desde: null,
      })
      .eq('id', v.id)
      .in('transcricao_status', ['falhou', 'transcrevendo'])
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[ligacoes] encerrar a transcrição vencida falhou:', v.id, error.message);
      return;
    }
    if (encerrada) await sincronizarFaixa(db, v.id);
  }
  const { data, error } = await db
    .from('cb_ligacoes')
    .select('id')
    .eq('pelo_crm', true)
    .not('atendida_pelo_crm_em', 'is', null)
    .is('gravacao_expirada_em', null)
    .gte('criada_em', desde)
    // Sem o teto de tentativas aqui: a `transcrevendo` travada na ÚLTIMA
    // tentativa só sai (como `recusada`) passando por `transcreverLigacao`.
    // A `falhou` sempre tem tentativa sobrando (a 3ª falha já é `recusada`).
    .or('transcricao_status.is.null,transcricao_status.in.(falhou,transcrevendo)')
    // As que já FALHARAM (ou travaram) antes das nunca tentadas — estas o
    // `after()` normalmente já pegou, e uma conta sem chave as acumula; dentro
    // de cada grupo, as mais novas primeiro.
    .order('transcricao_status', { ascending: true, nullsFirst: false })
    .order('criada_em', { ascending: false })
    .limit(POR_CICLO * 4);
  if (error) {
    console.error('[ligacoes] transcrições pendentes: leitura falhou:', error.message);
    return;
  }
  let feitas = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    if (feitas >= POR_CICLO || Date.now() + PRAZO_DO_LADO_MS + PRAZO_DO_RESUMO_MS > prazo) return;
    const r = await transcreverLigacao(db, id);
    if (r === 'pronta' || r === 'falhou' || r === 'recusada') feitas += 1;
  }
}
