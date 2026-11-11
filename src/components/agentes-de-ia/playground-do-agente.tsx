'use client';

// O Playground de UM agente (F1b): o mesmo pedido e o mesmo modelo da
// produção, sem WhatsApp. O gasto conta como TESTE (D13).
//
// O RASCUNHO (DC4 da central dos agentes, 26/10/2026): o Playground testa o
// que está NA TELA, sem salvar — o que o Salvar da Configuração, do Acesso,
// das Ferramentas e da Retomada mandaria agora (`rascunho`, juntado no
// detalhe) —, conferido no servidor como no salvar (rascunho que não se salva
// devolve o mesmo erro). "Testar: Salvo | Rascunho" escolhe a versão, com a
// lista do que mudou (e do que não muda a resposta: ligado, conexões,
// etapas…). A Base de conhecimento é sempre a SALVA: o aviso âmbar é só dela.
// A conversa NÃO zera ao salvar: cada resposta leva o selo da versão que a
// gerou ("salvo às 14:32" ou "rascunho"). Para não confundir versões numa
// conversa só, há:
//   - "Comparar com o salvo": a última mensagem do cliente gerada pelas DUAS
//     versões, lado a lado (2 chamadas);
//   - "Rodar o roteiro de novo": refaz todas as respostas com a versão
//     escolhida, a partir só das mensagens do cliente (as respostas novas são
//     o contexto). Diz antes quantas chamadas fará; o limite por minuto da
//     rota (429) PAUSA e retoma — não é erro. Parar ou falhar devolve a
//     conversa de antes;
//   - "Mostrar o pedido enviado ao modelo" (sob demanda; o Playground é só de
//     administrador, D14): cada resposta nova traz o texto que foi ao modelo.
//
// F3: um cliente OPCIONAL — com ele, o agente vê os dados desse contato que
// estão marcados em Acesso; sem ele, só a conversa. Debaixo de cada resposta,
// o que o agente viu (os blocos e quantos trechos da base), que é o que
// responde "por que ele sabia disso?". O cliente escolhido mora no DETALHE.
// Trocar de cliente zera a conversa — a de um, mandada como se fosse do
// outro, não testa nada.
//
// F4 (D28): as ações que o agente pediu junto com a resposta aparecem
// debaixo dela como SIMULADAS — no Playground nada executa —, com o valor
// ("preencher Tamanho da dívida = 200 mil", "tarefa para Ana: Ligar
// amanhã"), e as que o servidor recusou (número fora da lista, item não
// liberado) também. Link
// que não veio do pedido (`linkInventado`) ganha o aviso: em produção a
// resposta seria retida e a conversa iria para uma pessoa. O mesmo para a
// resposta que diz que marcou a reunião SEM o marcador (`reuniaoPrometida`,
// 27/09/2026). A transferência que a resposta prometeu sem o `[[TRANSFERIR]]`
// aparece entre as simuladas, com o aviso de que foi inferida
// (`transferenciaInferida`). E a resposta que reproduz o pedido interno
// (`pedidoVazado`, as regras do sistema de 27/09/2026) ganha o aviso
// vermelho: em produção ela seria retida. O mesmo para a resposta que diz que
// FEZ algo no sistema (criou a tarefa, gravou o campo, moveu o card…) sem a
// ação que o faça (`acaoPrometida`, 25/10/2026).
//
// A PASSAGEM com ações (25/10/2026): campo, etiqueta e tarefa da resposta que
// passa a conversa rodariam ANTES de o card ir para o outro agente — aparecem
// como "antes de passar"; mover, automação e reunião, entre as recusadas.
//
// F5 (D7): com "Marcar reunião" ligado, a rota lê os horários livres do
// Calendly AO VIVO e devolve os que foram oferecidos ao modelo
// (`horarios`); eles aparecem debaixo da resposta — recolhidos quando
// passam de 4 —, porque é o que explica o horário que o agente propôs. A
// reunião escolhida vira a ação simulada "marcar reunião em …": nada é
// marcado aqui. `horarios` nulo (tipo desligado, leitura que falhou, cliente
// que já tem reunião) não mostra nada; lista vazia diz que não havia horário
// livre.
//
// RETOMADA (1056): "Simular retomada" gera a mensagem que o agente mandaria se
// o cliente NÃO respondesse à última resposta dele (a tentativa seguinte da
// cadência da versão testada — a do rascunho, se ela mudou), sem enviar nada.
// O texto entra na conversa como uma resposta marcada "Retomada k/n
// (simulada)"; quando nada sairia ("nada pendente", a equipe pedida, link
// inventado), a bolha diz por quê, e a série para — até o cliente do teste
// escrever de novo. Com a retomada DESLIGADA na versão testada, a bolha avisa
// que na produção nada sairia. O botão só acende quando o turno real ARMARIA
// uma retomada: a última resposta saiu sem transferir nem passar a conversa.
//
// O RAIO-X (10/11/2026, `playground-raio-x.tsx`): as ações saem em CARTÕES
// debaixo da resposta (com o "Transferir para" da versão testada quando a
// conversa iria para a equipe); "Bastidores" guarda o resumo do raciocínio
// do modelo, o que ele escreveu com os marcadores, o que viu e o pedido; e o
// painel "O lead depois desta conversa", ao lado, soma tudo o que o agente
// teria feito. Tudo derivado do que a rota devolve — nada a mais é gravado.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Ban,
  Bot,
  CalendarClock,
  Columns2,
  History,
  ListRestart,
  Loader2,
  PowerOff,
  RotateCcw,
  Send,
  UserCircle2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/use-auth';
import { SeletorDeContatoRemoto } from '@/components/contacts/seletor-de-contato-remoto';
import { fetchAccountMembersOrNull, memberLabel } from '@/lib/account/members';
import { mostraRaciocinio } from '@/lib/ai/providers/raciocinio';
import type { AiProvider } from '@/lib/ai/types';
import { TETO_DE_RESULTADOS } from '@/lib/contacts/busca-remota';
import { ACAO_TRANSFERIR } from '@/lib/ia-agentes/acoes';
import { lerRetomada } from '@/lib/ia-agentes/retomada';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { Bastidores, EfeitosDaResposta, idDaResposta, PainelDoLead, type DestinoDaTransferencia } from './playground-raio-x';
import {
  HORARIOS_A_MOSTRA,
  esperaDoLimite,
  lerAcoesSimuladas,
  lerHorariosOferecidos,
  lerRetomadaSimulada,
} from './ferramentas';
import { NAO_MUDAM_A_RESPOSTA } from './rascunho';
import type { AcoesSimuladas, HorarioOferecido, IaAgente } from './tipos';
import { rotuloDaChaveDoRascunho, textoDaParadaDaRetomada, textoDoCodigo } from './textos';

/** O que o agente viu para gerar a resposta (`vistos` da rota). */
interface Vistos {
  blocos: string[];
  /** Os TRECHOS da base que entraram no pedido (não os documentos). */
  trechos: number;
}

/** Parse, nunca `as`: resposta estranha vira "não se sabe" (nada é mostrado). */
function lerVistos(v: unknown): Vistos | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { blocos, trechos } = v as { blocos?: unknown; trechos?: unknown };
  if (!Array.isArray(blocos) || typeof trechos !== 'number') return undefined;
  return { blocos: blocos.filter((b): b is string => typeof b === 'string'), trechos };
}

/** A versão do agente que gerou uma resposta (o selo da bolha; DC4). `em` = o `updatedAt` do salvo. */
type Versao = { tipo: 'salvo'; em: string } | { tipo: 'rascunho' };

interface Turno {
  role: 'user' | 'assistant';
  content: string;
  /** Só do agente: ele pediu transferência para gente neste turno. */
  handoff?: boolean;
  /** Só do agente: ele passaria a conversa para este agente (D25). */
  passaPara?: string;
  tokens?: number;
  /** Só do agente: o que ele viu (F3). */
  vistos?: Vistos;
  /** Só do agente: as ações que ele pediu, SIMULADAS (F4). */
  acoes?: AcoesSimuladas;
  /** Só do agente: a resposta reproduz o pedido interno (as regras do sistema, 27/09). */
  pedidoVazado?: boolean;
  /** Só do agente: a resposta tem um link que não veio do pedido (F4). */
  linkInventado?: boolean;
  /** Só do agente: a resposta diz que marcou a reunião sem o marcador (F5, 27/09). */
  reuniaoPrometida?: boolean;
  /** Só do agente: a resposta diz que fez algo no sistema sem a ação que o faça (25/10/2026). */
  acaoPrometida?: boolean;
  /** Só do agente: a resposta prometeu a equipe sem o `[[TRANSFERIR]]` — a transferência simulada foi inferida (27/09). */
  transferenciaInferida?: boolean;
  /** Só do agente: os horários livres oferecidos ao modelo (F5); nulo = nada a mostrar. */
  horarios?: HorarioOferecido[] | null;
  /** Só do agente: esta é uma RETOMADA simulada (1056); `parada` = nada sairia, e por quê. */
  retomada?: { tentativa: number; de: number; parada: string | null; desligada: boolean };
  /** Só do agente: a versão que gerou esta resposta (DC4). */
  versao?: Versao;
  /** Só do agente: o pedido que foi ao modelo, quando pedido (`verPedido`). */
  pedido?: string;
  /** Só do agente: o resumo do raciocínio (10/11/2026); `null` = o modelo não o devolveu. */
  raciocinio?: string | null;
  /** Só do agente: o modelo da versão que respondeu devolve o raciocínio (`mostraRaciocinio`). */
  mostraRaciocinio?: boolean;
  /** Só do agente: o que o modelo escreveu, com os marcadores (fora a retomada). */
  respostaCrua?: string;
  /** Só do agente: o "Transferir para" da versão que gerou esta resposta (nulo = a fila). */
  transferirPara?: string | null;
}

/** Um lado da comparação salvo × rascunho. */
type LadoDaComparacao = { fase: 'carregando' } | { fase: 'falhou'; texto: string } | { fase: 'pronto'; turno: Turno };

interface Comparacao {
  /** A última mensagem do cliente, a que as duas versões responderam. */
  pergunta: string;
  /** A hora da versão salva comparada. */
  salvoEm: string;
  salvo: LadoDaComparacao;
  rascunho: LadoDaComparacao;
}

/** "Rodar o roteiro de novo" em andamento; `pausadoAte` = o limite por minuto (instante em ms). */
interface Roteiro {
  feitas: number;
  total: number;
  pausadoAte: number | null;
}

/** Sem o tempo dito pelo servidor (o 429 do PROVEDOR), quanto esperar antes de tentar de novo. */
const ESPERA_PADRAO_S = 20;

/** A conversa como a rota a recebe. */
function paraARota(turnos: Turno[]) {
  return turnos.map((x) => ({ role: x.role, content: x.content }));
}

/** Os bastidores da resposta (10/11/2026): parse, nunca `as`. */
function lerBastidores(corpo: Record<string, unknown>, mostra: boolean): Pick<Turno, 'raciocinio' | 'mostraRaciocinio' | 'respostaCrua'> {
  return {
    raciocinio: typeof corpo.raciocinio === 'string' && corpo.raciocinio.trim() ? corpo.raciocinio : null,
    mostraRaciocinio: mostra,
    ...(typeof corpo.respostaCrua === 'string' ? { respostaCrua: corpo.respostaCrua } : {}),
  };
}

/** O corpo da resposta da rota → a bolha do agente. `mostra` = o modelo da versão devolve o raciocínio. */
function turnoDaResposta(
  corpo: Record<string, unknown>,
  versao: Versao,
  mostra: boolean,
  transferirPara: string | null,
): Turno {
  const usage = corpo.usage as { totalTokens?: unknown } | null | undefined;
  return {
    ...lerBastidores(corpo, mostra),
    transferirPara,
    role: 'assistant',
    content: typeof corpo.reply === 'string' ? corpo.reply : '',
    handoff: corpo.handoff === true,
    passaPara: typeof corpo.passaPara === 'string' ? corpo.passaPara : undefined,
    tokens: typeof usage?.totalTokens === 'number' ? usage.totalTokens : undefined,
    vistos: lerVistos(corpo.vistos),
    acoes: lerAcoesSimuladas(corpo.acoes),
    pedidoVazado: corpo.pedidoVazado === true,
    linkInventado: corpo.linkInventado === true,
    reuniaoPrometida: corpo.reuniaoPrometida === true,
    acaoPrometida: corpo.acaoPrometida === true,
    transferenciaInferida: corpo.transferenciaInferida === true,
    horarios: lerHorariosOferecidos(corpo.horarios),
    versao,
    pedido: typeof corpo.pedido === 'string' ? corpo.pedido : undefined,
  };
}

/** O modelo de uma versão: o do rascunho, se ele o mudou; senão o salvo. */
function modeloDa(rascunho: Record<string, unknown> | null, agente: IaAgente): string {
  return rascunho && typeof rascunho.modelo === 'string' && rascunho.modelo.trim() ? rascunho.modelo.trim() : agente.modelo;
}

/** O provedor de uma versão: o do rascunho, se ele o mudou; senão o salvo. */
function provedorDa(rascunho: Record<string, unknown> | null, agente: IaAgente): AiProvider {
  const p = rascunho?.provedor;
  return p === 'openai' || p === 'anthropic' || p === 'gemini' ? p : agente.provedor;
}

/** "14:32" no idioma de quem vê; data ilegível = travessão. */
function horaDe(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Espera `ms`, acordando a cada meio segundo para ver se pediram para parar. */
async function esperar(ms: number, parar: () => boolean): Promise<void> {
  const fim = Date.now() + ms;
  while (Date.now() < fim && !parar()) {
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, fim - Date.now()))));
  }
}

/**
 * A próxima retomada que dá para simular (1-based), ou `null`: a conversa
 * termina numa resposta do agente que SAIU sem transferir nem passar (a que o
 * turno real ARMARIA), a série não parou e a cadência não acabou.
 */
function proximaRetomada(turnos: Turno[], cadencia: number): number | null {
  let seguidas = 0;
  for (let i = turnos.length - 1; i >= 0; i--) {
    const x = turnos[i];
    if (x.role !== 'assistant' || !x.retomada) break;
    if (x.retomada.parada) return null;
    seguidas++;
  }
  const ultima = turnos.at(-1);
  if (!ultima || ultima.role !== 'assistant' || !ultima.content) return null;
  if (
    ultima.handoff ||
    ultima.passaPara ||
    // RETIDA na produção (e o turno transfere): nunca armaria (Codex, PR #328).
    ultima.pedidoVazado ||
    ultima.linkInventado ||
    ultima.reuniaoPrometida ||
    ultima.acaoPrometida ||
    ultima.acoes?.aceitas.some((a) => a.tipo === ACAO_TRANSFERIR)
  ) {
    return null;
  }
  return seguidas < cadencia ? seguidas + 1 : null;
}

type Falha = { ok: false; texto: string; descricao?: string; esperaMs: number | null };

export function PlaygroundDoAgente({
  agente,
  rascunho,
  naoSalvoEm,
  baseNaoSalva,
  contatoId,
  aoMudarContato,
}: {
  agente: IaAgente;
  /** O que as abas salvariam agora (o corpo PARCIAL do PATCH); `null` = nada mudou na tela (DC4). */
  rascunho: Record<string, unknown> | null;
  /** Os nomes das abas com alteração não salva (a Base inclusive). */
  naoSalvoEm: string[];
  /** A Base tem alteração não salva: o teste usa os documentos SALVOS, sempre. */
  baseNaoSalva: boolean;
  /** O cliente do teste; `''` = nenhum (só a conversa). */
  contatoId: string;
  aoMudarContato: (id: string) => void;
}) {
  const t = useTranslations('IaAgentes');
  const { accountId } = useAuth();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  // "Testar: Salvo | Rascunho" (DC4): o rascunho por padrão — é o que está na tela.
  const [testar, setTestar] = useState<'salvo' | 'rascunho'>('rascunho');
  const [verPedido, setVerPedido] = useState(false);
  const [comparacao, setComparacao] = useState<Comparacao | null>(null);
  const [roteiro, setRoteiro] = useState<Roteiro | null>(null);
  const [confirmandoRoteiro, setConfirmandoRoteiro] = useState(false);
  const rolagemRef = useRef<HTMLDivElement>(null);
  // "Parar" o roteiro, e o componente que saiu da tela (a rodada não segue gastando).
  const pararRef = useRef(false);
  const vivoRef = useRef(true);
  // A versão SALVA de agora: o roteiro para se alguém salvar no meio da rodada
  // (as respostas seguintes sairiam da versão nova com o selo da antiga).
  const salvoEmRef = useRef(agente.updatedAt);

  const usaRascunho = testar === 'rascunho' && rascunho !== null;
  const rascunhoDaChamada = usaRascunho ? rascunho : null;
  const versaoDaChamada: Versao = usaRascunho ? { tipo: 'rascunho' } : { tipo: 'salvo', em: agente.updatedAt };
  // A cadência da versão testada: a do rascunho, se a Retomada mudou.
  const cadencia =
    usaRascunho && rascunho.retomada !== undefined ? lerRetomada(rascunho.retomada).cadencia : agente.retomada.cadencia;
  const tentativaDaRetomada = proximaRetomada(turnos, cadencia.length);
  const comparando =
    comparacao !== null && (comparacao.salvo.fase === 'carregando' || comparacao.rascunho.fase === 'carregando');
  const ocupado = enviando || comparando || roteiro !== null;
  const doCliente = turnos.filter((x) => x.role === 'user').length;
  // O número de cada resposta do agente (1, 2…), o mesmo que o painel do lead mostra.
  let respostasAteAqui = 0;
  const numeroDaResposta = turnos.map((x) => (x.role === 'assistant' ? ++respostasAteAqui : 0));
  const modelo = modeloDa(usaRascunho ? rascunho : null, agente);
  // O modelo de cada versão devolve o resumo do raciocínio? (os Bastidores dizem quando não)
  const mostraNoSalvo = mostraRaciocinio(agente.provedor, agente.modelo);
  const mostraNoRascunho = mostraRaciocinio(provedorDa(rascunho, agente), modeloDa(rascunho, agente));
  const mostraODaVersao = usaRascunho ? mostraNoRascunho : mostraNoSalvo;

  // "Transferir para" da versão testada: a quem a conversa iria (10/11/2026).
  // A equipe é lida só para dar NOME ao id; `undefined` = ainda carregando,
  // `null` = não carregou (nunca "fora da equipe").
  const [membros, setMembros] = useState<AccountMember[] | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const m = await fetchAccountMembersOrNull();
      if (vivo) setMembros(m);
    })();
    return () => {
      vivo = false;
    };
  }, []);
  // O "Transferir para" de uma versão (o do rascunho, se ele o mudou). Cada
  // resposta guarda o DA VERSÃO QUE A GEROU (Codex, #495): na comparação, o
  // salvo e o rascunho podem transferir para pessoas diferentes, e trocar
  // "Testar" depois não muda o que uma resposta antiga diria.
  const transferirParaDa = (r: Record<string, unknown> | null): string | null =>
    r && r.transferir_para !== undefined
      ? typeof r.transferir_para === 'string'
        ? r.transferir_para
        : null
      : agente.transferirPara;
  const transferirParaDaChamada = transferirParaDa(rascunhoDaChamada);
  /** O destino em texto, com o nome pela equipe lida. */
  const destinoDe = (id: string | null): DestinoDaTransferencia => {
    const membro = id && membros ? membros.find((m) => m.user_id === id) : undefined;
    return {
      texto:
        id === null
          ? t('playground.destinoFila')
          : membro
            ? t('playground.destinoMembro', { nome: memberLabel(membro) })
            : membros === undefined
              ? t('playground.destinoCarregando')
              : t('playground.destinoDesconhecido'),
      pessoa: id !== null,
    };
  };
  /** O destino de uma resposta: o da versão que a gerou (a de agora, se ela não o guardou). */
  const destinoDaResposta = (x: { transferirPara?: string | null }): DestinoDaTransferencia =>
    destinoDe(x.transferirPara !== undefined ? x.transferirPara : transferirParaDaChamada);

  // O que mudou no rascunho, separado do que não muda a resposta do teste.
  const chaves = rascunho ? Object.keys(rascunho) : [];
  const rotulos = (lista: string[]) =>
    lista.map((c) => rotuloDaChaveDoRascunho(t, c)).filter((r): r is string => r !== null);
  const mudamAResposta = rotulos(chaves.filter((c) => !NAO_MUDAM_A_RESPOSTA.has(c)));
  const naoMudam = rotulos(chaves.filter((c) => NAO_MUDAM_A_RESPOSTA.has(c)));

  useEffect(() => {
    rolagemRef.current?.scrollTo({ top: rolagemRef.current.scrollHeight });
  }, [turnos, enviando, comparacao]);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  useEffect(() => {
    salvoEmRef.current = agente.updatedAt;
  }, [agente.updatedAt]);

  function trocarContato(id: string) {
    if (id === contatoId) return;
    aoMudarContato(id);
    setTurnos([]);
    setComparacao(null);
  }

  /**
   * Uma chamada à rota (o cliente do teste e o "ver o pedido" vão junto).
   * Nunca lança: a falha vem com o texto e, no limite por minuto (429), com
   * quanto esperar.
   */
  async function chamar(corpo: Record<string, unknown>): Promise<{ ok: true; corpo: Record<string, unknown> } | Falha> {
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...corpo,
          ...(contatoId ? { contactId: contatoId } : {}),
          ...(verPedido ? { verPedido: true } : {}),
        }),
      });
      const lido = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return { ok: true, corpo: lido };
      const esperaMs = esperaDoLimite(res.status, lido, res.headers.get('Retry-After'), ESPERA_PADRAO_S);
      if (esperaMs !== null) {
        // Sem `code` = o limite por minuto da ROTA (com o tempo); com, o do provedor.
        const texto =
          typeof lido.code === 'string'
            ? textoDoCodigo(t, lido.code, lido.error)
            : t('playground.limiteDeTestes', { s: esperaMs / 1000 });
        return { ok: false, texto, esperaMs };
      }
      return {
        ok: false,
        texto: textoDoCodigo(t, lido.code, lido.code === 'etapa_ocupada' ? lido.outroAgente : lido.error),
        // A recusa do RASCUNHO (o servidor a marca): ele também não passaria no Salvar.
        descricao: res.headers.get('x-rascunho-recusado') === '1' ? t('playground.rascunhoRecusado') : undefined,
        esperaMs: null,
      };
    } catch {
      return { ok: false, texto: t('erro.generico'), esperaMs: null };
    }
  }

  function avisarFalha(r: Falha, descricao?: string) {
    toast.error(r.texto, r.descricao || descricao ? { description: r.descricao ?? descricao } : undefined);
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || ocupado) return;
    const antes = turnos;
    const proximos: Turno[] = [...turnos, { role: 'user', content: conteudo }];
    const versao = versaoDaChamada;
    const mostra = mostraODaVersao;
    const destino = transferirParaDaChamada;
    setTurnos(proximos);
    setTexto('');
    setComparacao(null);
    setEnviando(true);
    const r = await chamar({
      messages: paraARota(proximos),
      ...(rascunhoDaChamada ? { rascunho: rascunhoDaChamada } : {}),
    });
    setEnviando(false);
    if (!r.ok) {
      avisarFalha(r);
      setTurnos(antes);
      setTexto(conteudo);
      return;
    }
    setTurnos([...proximos, turnoDaResposta(r.corpo, versao, mostra, destino)]);
  }

  async function simularRetomada() {
    if (ocupado || tentativaDaRetomada === null) return;
    const versao = versaoDaChamada;
    const mostra = mostraODaVersao;
    const destino = transferirParaDaChamada;
    setComparacao(null);
    setEnviando(true);
    const r = await chamar({
      messages: paraARota(turnos),
      retomada: true,
      tentativa: tentativaDaRetomada,
      ...(rascunhoDaChamada ? { rascunho: rascunhoDaChamada } : {}),
    });
    setEnviando(false);
    if (!r.ok) {
      avisarFalha(r);
      return;
    }
    const lida = lerRetomadaSimulada(r.corpo.retomada);
    if (!lida) {
      toast.error(t('erro.generico'));
      return;
    }
    const usage = r.corpo.usage as { totalTokens?: unknown } | null | undefined;
    setTurnos([
      ...turnos,
      {
        role: 'assistant',
        content: lida.texto,
        tokens: typeof usage?.totalTokens === 'number' ? usage.totalTokens : undefined,
        vistos: lerVistos(r.corpo.vistos),
        retomada: { tentativa: lida.tentativa, de: lida.de, parada: lida.parada, desligada: lida.desligada },
        versao,
        pedido: typeof r.corpo.pedido === 'string' ? r.corpo.pedido : undefined,
        ...lerBastidores(r.corpo, mostra),
        transferirPara: destino,
      },
    ]);
  }

  /** "Comparar com o salvo": a última mensagem do cliente pelas duas versões (2 chamadas). */
  async function comparar() {
    if (!rascunho || ocupado) return;
    let ate = -1;
    for (let i = turnos.length - 1; i >= 0; i--) {
      if (turnos[i].role === 'user') {
        ate = i;
        break;
      }
    }
    if (ate < 0) return;
    const mensagens = paraARota(turnos.slice(0, ate + 1));
    const salvoEm = agente.updatedAt;
    const doRascunho = rascunho;
    setComparacao({ pergunta: turnos[ate].content, salvoEm, salvo: { fase: 'carregando' }, rascunho: { fase: 'carregando' } });
    const [s, r] = await Promise.all([
      chamar({ messages: mensagens }),
      chamar({ messages: mensagens, rascunho: doRascunho }),
    ]);
    const lado = (x: typeof s, versao: Versao, mostra: boolean, destino: string | null): LadoDaComparacao =>
      x.ok ? { fase: 'pronto', turno: turnoDaResposta(x.corpo, versao, mostra, destino) } : { fase: 'falhou', texto: x.texto };
    setComparacao({
      pergunta: turnos[ate].content,
      salvoEm,
      // Cada lado com o "Transferir para" da SUA versão (Codex, #495).
      salvo: lado(s, { tipo: 'salvo', em: salvoEm }, mostraNoSalvo, agente.transferirPara),
      rascunho: lado(r, { tipo: 'rascunho' }, mostraNoRascunho, transferirParaDa(doRascunho)),
    });
  }

  /**
   * "Rodar o roteiro de novo": as mensagens do cliente, uma a uma, com as
   * respostas NOVAS como contexto e a versão escolhida AGORA (fixa na rodada).
   * O limite por minuto (da rota ou do provedor) pausa e retoma; parar,
   * falhar ou SALVAR o agente no meio devolve a conversa de antes.
   */
  async function rodarRoteiro() {
    setConfirmandoRoteiro(false);
    const mensagens = turnos.filter((x) => x.role === 'user').map((x) => x.content);
    if (mensagens.length === 0 || ocupado) return;
    const antes = turnos;
    const versao = versaoDaChamada;
    const mostra = mostraODaVersao;
    const destino = transferirParaDaChamada;
    const doRascunho = rascunhoDaChamada;
    const salvoNoInicio = agente.updatedAt;
    const salvouNoMeio = () => salvoEmRef.current !== salvoNoInicio;
    const total = mensagens.length;
    pararRef.current = false;
    setComparacao(null);
    let novos: Turno[] = [];
    setTurnos(novos);
    setRoteiro({ feitas: 0, total, pausadoAte: null });
    try {
      for (const [i, conteudo] of mensagens.entries()) {
        novos = [...novos, { role: 'user', content: conteudo }];
        setTurnos(novos);
        for (;;) {
          if (!vivoRef.current) return;
          if (pararRef.current) {
            setTurnos(antes);
            toast.info(t('playground.roteiroParou'));
            return;
          }
          if (salvouNoMeio()) {
            setTurnos(antes);
            toast.info(t('playground.roteiroSalvouNoMeio'));
            return;
          }
          const r = await chamar({ messages: paraARota(novos), ...(doRascunho ? { rascunho: doRascunho } : {}) });
          // "Parar" ou Salvar DURANTE a chamada: a resposta não entra; o topo do
          // laço devolve a conversa de antes (Codex #442).
          if (!vivoRef.current || pararRef.current || salvouNoMeio()) continue;
          if (r.ok) {
            novos = [...novos, turnoDaResposta(r.corpo, versao, mostra, destino)];
            setTurnos(novos);
            setRoteiro({ feitas: i + 1, total, pausadoAte: null });
            break;
          }
          if (r.esperaMs === null) {
            setTurnos(antes);
            avisarFalha(r, t('playground.roteiroVoltou'));
            return;
          }
          // O limite por minuto (da rota: 20 por pessoa, 60 por conta; ou do
          // provedor): pausa e continua.
          setRoteiro({ feitas: i, total, pausadoAte: Date.now() + r.esperaMs });
          await esperar(r.esperaMs, () => pararRef.current || !vivoRef.current || salvouNoMeio());
          setRoteiro({ feitas: i, total, pausadoAte: null });
        }
      }
    } finally {
      if (vivoRef.current) setRoteiro(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('playground.explicacao')}</p>
      {rascunho ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground">{t('playground.testar')}</span>
            <div className="flex gap-1" role="group" aria-label={t('playground.testar')}>
              {(['salvo', 'rascunho'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={testar === v}
                  disabled={ocupado}
                  onClick={() => setTestar(v)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50',
                    testar === v ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'
                  )}
                >
                  {v === 'salvo' ? t('playground.testarSalvo') : t('playground.testarRascunho')}
                </button>
              ))}
            </div>
          </div>
          {usaRascunho ? (
            <>
              {mudamAResposta.length > 0 ? (
                <p className="text-xs text-foreground">{t('playground.rascunhoMudou', { itens: mudamAResposta.join(', ') })}</p>
              ) : null}
              {naoMudam.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('playground.rascunhoSemEfeito', { itens: naoMudam.join(', ') })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('playground.naoSalvo', { abas: naoSalvoEm.join(', ') })}</p>
          )}
        </div>
      ) : null}
      {baseNaoSalva ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('playground.baseNaoSalva')}</p> : null}
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm text-foreground">{t('playground.contato')}</span>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <SeletorDeContatoRemoto
              value={contatoId}
              onChange={trocarContato}
              disabled={ocupado}
              placeholder={t('playground.contatoNenhum')}
              searchPlaceholder={t('playground.contatoBuscar')}
              hintText={t('playground.contatoAjuda')}
              loadingText={t('playground.carregandoContatos')}
              emptyText={t('playground.contatoVazio')}
              failedText={t('playground.contatoFalhou')}
              moreText={t('playground.contatoMais', { count: TETO_DE_RESULTADOS })}
              ariaLabel={t('playground.contato')}
              accountId={accountId ?? undefined}
            />
          </div>
          {contatoId ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={ocupado}
              aria-label={t('playground.limparContato')}
              title={t('playground.limparContato')}
              onClick={() => trocarContato('')}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('playground.contatoDica')}</p>
      </div>
      <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground" title={t('playground.verPedidoDica')}>
        <Checkbox checked={verPedido} onCheckedChange={(v) => setVerPedido(v === true)} />
        {t('playground.verPedido')}
      </label>
      {/* A conversa e, ao lado (embaixo no celular), a soma do que o agente teria feito. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex h-[60vh] min-h-[420px] min-w-0 flex-col rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {agente.nome} · <code className="text-xs text-muted-foreground">{modelo}</code>
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {rascunho ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void comparar()}
                disabled={doCliente === 0 || ocupado}
                title={t('playground.compararDica')}
                className="text-muted-foreground"
              >
                <Columns2 className="mr-1.5 size-3.5" /> {t('playground.comparar')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmandoRoteiro(true)}
              disabled={doCliente === 0 || ocupado}
              title={t('playground.roteiroDica')}
              className="text-muted-foreground"
            >
              <ListRestart className="mr-1.5 size-3.5" /> {t('playground.roteiro')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void simularRetomada()}
              disabled={tentativaDaRetomada === null || ocupado}
              title={t('playground.simularRetomadaDica')}
              className="text-muted-foreground"
            >
              <History className="mr-1.5 size-3.5" /> {t('playground.simularRetomada')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTurnos([]);
                setComparacao(null);
              }}
              disabled={turnos.length === 0 || ocupado}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1.5 size-3.5" /> {t('playground.recomecar')}
            </Button>
          </div>
        </div>

        <div ref={rolagemRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turnos.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Bot className="mb-2 size-8 text-muted-foreground/60" />
              <p>{t('playground.vazio')}</p>
            </div>
          ) : null}
          {turnos.map((x, i) => (
            <div
              key={i}
              // A resposta n do agente: o painel do lead leva até ela.
              id={x.role === 'assistant' ? idDaResposta(agente.id, numeroDaResposta[i]) : undefined}
              className={cn('flex scroll-m-4 gap-2', x.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {x.role === 'assistant' ? <Bot className="mt-1 size-5 shrink-0 text-primary" /> : null}
              <div
                className={cn(
                  // `min-w-0` + `break-words`: um link longo (o do boleto,
                  // justo o que o agente de cobrança manda) não vaza da bolha.
                  'min-w-0 break-words rounded-2xl px-3.5 py-2 text-sm',
                  x.role === 'user'
                    ? 'max-w-[80%] rounded-br-sm bg-primary text-primary-foreground'
                    : 'max-w-[88%] rounded-bl-sm bg-muted text-foreground'
                )}
              >
                {x.role === 'assistant' ? (
                  <ConteudoDaResposta x={x} destinoDaTransferencia={destinoDaResposta(x)} />
                ) : (
                  <p className="whitespace-pre-wrap">{x.content}</p>
                )}
              </div>
              {x.role === 'user' ? <UserCircle2 className="mt-1 size-5 shrink-0 text-muted-foreground" /> : null}
            </div>
          ))}
          {enviando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="size-5 text-primary" />
              <Loader2 className="size-4 animate-spin" /> {t('playground.pensando')}
            </div>
          ) : null}
          {comparacao ? (
            <div className="space-y-2 rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground">
                  <Columns2 className="mt-px size-3.5 shrink-0" />
                  <span className="line-clamp-2 break-words">
                    {t('playground.comparacaoTitulo', { mensagem: comparacao.pergunta })}
                  </span>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={comparando}
                  aria-label={t('playground.fecharComparacao')}
                  title={t('playground.fecharComparacao')}
                  onClick={() => setComparacao(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <LadoComparado
                  titulo={t('playground.comparacaoSalvo', { hora: horaDe(comparacao.salvoEm) })}
                  lado={comparacao.salvo}
                  destinoDaResposta={destinoDaResposta}
                />
                <LadoComparado
                  titulo={t('playground.comparacaoRascunho')}
                  lado={comparacao.rascunho}
                  destinoDaResposta={destinoDaResposta}
                />
              </div>
            </div>
          ) : null}
        </div>

        {confirmandoRoteiro ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="min-w-0 text-foreground">
              {t('playground.roteiroConfirma', { n: doCliente, versao: usaRascunho ? 'rascunho' : 'salvo' })}
            </span>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" onClick={() => void rodarRoteiro()} disabled={ocupado}>
                {t('playground.roteiroRodar')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmandoRoteiro(false)}>
                {t('cancelar')}
              </Button>
            </div>
          </div>
        ) : null}
        {roteiro ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              {roteiro.pausadoAte !== null
                ? t('playground.roteiroPausado', {
                    hora: new Date(roteiro.pausadoAte).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }),
                  })
                : t('playground.roteiroRodando', { feitas: roteiro.feitas, total: roteiro.total })}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                pararRef.current = true;
              }}
            >
              {t('playground.roteiroParar')}
            </Button>
          </div>
        ) : null}

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={t('playground.placeholder')}
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          />
          <Button size="sm" onClick={() => void enviar()} disabled={!texto.trim() || ocupado} className="size-9 shrink-0 p-0">
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
      <PainelDoLead turnos={turnos} agenteId={agente.id} destinoDaResposta={destinoDaResposta} />
      </div>
    </div>
  );
}

/** Um lado da comparação salvo × rascunho: carregando, a falha, ou a resposta com tudo o que a bolha mostra. */
function LadoComparado({
  titulo,
  lado,
  destinoDaResposta,
}: {
  titulo: string;
  lado: LadoDaComparacao;
  destinoDaResposta: (x: Turno) => DestinoDaTransferencia;
}) {
  return (
    <div className="min-w-0 break-words rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{titulo}</p>
      {lado.fase === 'carregando' ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : lado.fase === 'falhou' ? (
        <p className="text-xs text-red-700 dark:text-red-300">{lado.texto}</p>
      ) : (
        <ConteudoDaResposta x={lado.turno} destinoDaTransferencia={destinoDaResposta(lado.turno)} />
      )}
    </div>
  );
}

/**
 * O que a bolha do agente mostra: o texto (ou a retomada simulada), os
 * horários, os cartões do que aconteceria no CRM (as ações, a passagem ou a
 * transferência, as travas e as recusadas), os bastidores (raciocínio,
 * resposta crua, o que viu, o pedido) e o rodapé com o selo da versão que a
 * gerou e os tokens.
 */
function ConteudoDaResposta({ x, destinoDaTransferencia }: { x: Turno; destinoDaTransferencia: DestinoDaTransferencia }) {
  const t = useTranslations('IaAgentes');
  return (
    <>
      {x.retomada ? (
        <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <History className="size-3 shrink-0" />
          {t('playground.retomadaRotulo', { k: x.retomada.tentativa, n: x.retomada.de })}
        </p>
      ) : null}
      {x.content ? <p className="whitespace-pre-wrap">{x.content}</p> : null}
      {x.retomada?.parada ? (
        <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <Ban className="mt-px size-3.5 shrink-0" />
          <span>{textoDaParadaDaRetomada(t, x.retomada.parada)}</span>
        </p>
      ) : null}
      {x.retomada?.desligada ? (
        <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <PowerOff className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.retomadaDesligada')}</span>
        </p>
      ) : null}
      {x.horarios ? <HorariosOferecidos horarios={x.horarios} /> : null}
      {/* O raio-x (10/11/2026): um cartão por ação, as travas, a passagem ou a
          transferência (com o destino), as recusadas; e os bastidores. */}
      <EfeitosDaResposta x={x} destinoDaTransferencia={destinoDaTransferencia} />
      <Bastidores x={x} />
      {x.versao || x.tokens !== undefined ? (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {x.versao ? (
            <span
              className={cn(
                'rounded px-1 py-px',
                x.versao.tipo === 'rascunho' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-background/60'
              )}
            >
              {x.versao.tipo === 'rascunho'
                ? t('playground.versaoRascunho')
                : t('playground.versaoSalvo', { hora: horaDe(x.versao.em) })}
            </span>
          ) : null}
          {x.tokens !== undefined ? <span>{t('playground.tokens', { n: x.tokens })}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/**
 * Os horários livres que foram oferecidos ao modelo (F5), numa linha:
 * "Horários oferecidos: 1. 28/09/2026 15:15 · 2. …". Acima de
 * `HORARIOS_A_MOSTRA`, recolhidos (a lista vai a 15). O número é o que o
 * modelo leu; o texto, a data e a hora no fuso do escritório (o modelo lê o
 * mesmo horário com o dia da semana em inglês).
 */
function HorariosOferecidos({ horarios }: { horarios: HorarioOferecido[] }) {
  const t = useTranslations('IaAgentes');
  const classe = 'mt-1.5 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground';
  if (horarios.length === 0) {
    return (
      <p className={cn('flex items-start gap-1', classe)}>
        <CalendarClock className="mt-px size-3 shrink-0" />
        <span>{t('playground.horarios.nenhum')}</span>
      </p>
    );
  }
  const itens = horarios.map((h) => t('playground.horarios.item', { n: h.n, texto: h.texto })).join(' · ');
  if (horarios.length <= HORARIOS_A_MOSTRA) {
    return (
      <p className={cn('flex items-start gap-1', classe)}>
        <CalendarClock className="mt-px size-3 shrink-0" />
        <span>{t('playground.horarios.titulo', { itens })}</span>
      </p>
    );
  }
  return (
    <details className={classe}>
      <summary className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
        <CalendarClock className="size-3 shrink-0" /> {t('playground.horarios.recolhidos', { n: horarios.length })}
      </summary>
      <p className="mt-1">{itens}</p>
    </details>
  );
}
