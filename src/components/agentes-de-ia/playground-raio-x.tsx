'use client';

// ============================================================
// O "raio-x" do Playground (10/11/2026): o que o agente teria feito e por quê.
//
//   - `EfeitosDaResposta`: debaixo de cada resposta, um CARTÃO por ação
//     aceita ("Campo preenchido · Salário → R$ 2.800", "Card movido para
//     Funil › Etapa", "Passaria a conversa para a equipe · responsável: Ana"),
//     as recusadas ("Não faria") e as travas que reteriam a resposta. Antes,
//     tudo saía numa linha corrida em que o "·" separava as ações E o funil
//     da etapa.
//   - `Bastidores`: recolhido, o RESUMO do raciocínio que o provedor devolve
//     (`providers/raciocinio.ts`: só nos modelos que já raciocinam por
//     padrão — o mesmo raciocínio e o mesmo custo), o que o modelo escreveu
//     com os marcadores de ação, o que ele viu e o pedido (quando pedido).
//   - `PainelDoLead`: ao lado da conversa, a SOMA de tudo o que o agente teria
//     feito (`estado-do-lead.ts`) — etapa, etiquetas, campos, tarefas,
//     automações, reunião e com quem a conversa terminaria.
//
// Tudo é SIMULADO: nada aqui lê ou grava além do que a rota do Playground já
// devolve (`.claude/rules/ia-sandbox.md`).
// ============================================================

import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Ban,
  Bot,
  Brain,
  CalendarCheck,
  CalendarX,
  ClipboardX,
  Eye,
  FileText,
  Link2Off,
  ListTodo,
  PenLine,
  ShieldAlert,
  Tag,
  UserCircle2,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { FONTE_MONO } from '@/components/settings/copiar';
import { cn } from '@/lib/utils';
import { estadoDoLead, leadSemMudanca, nomeDaEtapa, type EstadoDoLead, type RespostaParaOLead } from './estado-do-lead';
import type { AcoesSimuladas } from './tipos';
import { efeitoDaAcao, fraseDaAcao, motivoDaRecusa, rotuloDoBloco, rotuloDoTipoDeAcao } from './textos';

/** O que uma resposta do agente traz para o raio-x (a bolha do Playground tem isto e mais). */
export interface RespostaDoRaioX {
  content: string;
  acoes?: AcoesSimuladas;
  handoff?: boolean;
  passaPara?: string;
  pedidoVazado?: boolean;
  linkInventado?: boolean;
  reuniaoPrometida?: boolean;
  acaoPrometida?: boolean;
  transferenciaInferida?: boolean;
  vistos?: { blocos: string[]; trechos: number };
  pedido?: string;
  /** O resumo do raciocínio; `null` = o modelo não o devolveu; ausente = não se sabe (resposta antiga). */
  raciocinio?: string | null;
  /** O modelo da versão testada devolve o raciocínio (`mostraRaciocinio`). */
  mostraRaciocinio?: boolean;
  /** O que o modelo escreveu, com os marcadores (fora a retomada). */
  respostaCrua?: string;
  /** O "Transferir para" da versão que gerou a resposta (nulo = a fila). */
  transferirPara?: string | null;
  retomada?: unknown;
}

/** Na produção a resposta seria RETIDA e iria para gente (as travas, na ordem do turno). */
export function respostaRetida(x: RespostaDoRaioX): boolean {
  return x.pedidoVazado === true || x.linkInventado === true || x.reuniaoPrometida === true || x.acaoPrometida === true;
}

/** O id da bolha da resposta `n` (o painel do lead leva até ela). */
export function idDaResposta(agenteId: string, n: number): string {
  return `playground-${agenteId}-resposta-${n}`;
}

const COR = {
  campo: 'bg-sky-500/15 text-sky-700',
  etiqueta: 'bg-emerald-500/15 text-emerald-700',
  etapa: 'bg-primary/15 text-primary',
  equipe: 'bg-amber-500/15 text-amber-700',
  neutro: 'bg-muted text-muted-foreground',
  recusa: 'bg-amber-500/15 text-amber-700',
} as const;

function IconeDaAcao({ tipo }: { tipo: string }) {
  const classe = 'size-3';
  switch (tipo) {
    case 'preencher_campo':
      return <PenLine className={classe} />;
    case 'etiquetar':
    case 'tirar_etiqueta':
      return <Tag className={classe} />;
    case 'mover_etapa':
      return <ArrowRight className={classe} />;
    case 'criar_tarefa':
      return <ListTodo className={classe} />;
    case 'executar_automacao':
      return <Zap className={classe} />;
    case 'marcar_reuniao':
      return <CalendarCheck className={classe} />;
    default:
      return <UserCircle2 className={classe} />;
  }
}

function corDaAcao(tipo: string): string {
  if (tipo === 'preencher_campo') return COR.campo;
  if (tipo === 'etiquetar' || tipo === 'tirar_etiqueta') return COR.etiqueta;
  if (tipo === 'mover_etapa') return COR.etapa;
  if (tipo === 'transferir') return COR.equipe;
  return COR.neutro;
}

function Cartao({
  icone,
  cor,
  titulo,
  children,
  dica,
}: {
  icone: ReactNode;
  cor: string;
  titulo: string;
  children?: ReactNode;
  dica?: string;
}) {
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5" title={dica}>
      <span className={cn('mt-px flex size-5 shrink-0 items-center justify-center rounded-md', cor)}>{icone}</span>
      <div className="min-w-0 break-words">
        <p className="text-[11px] text-muted-foreground">{titulo}</p>
        {children ? <div className="text-xs text-foreground">{children}</div> : null}
      </div>
    </li>
  );
}

/** O nome (em negrito) e, com valor, "→ “valor”". */
function NomeEValor({ tipo, nome, valor }: { tipo: string; nome: string; valor?: string }) {
  const t = useTranslations('IaAgentes');
  const exibido = tipo === 'mover_etapa' ? nomeDaEtapa(nome) : nome;
  return (
    <p>
      <span className="font-medium">{exibido}</span>
      {valor ? (
        tipo === 'marcar_reuniao' ? (
          <span className="text-muted-foreground"> · {t('playground.efeitoReuniaoNome', { valor })}</span>
        ) : (
          <span>
            {' '}
            <span className="text-muted-foreground">→</span> “{valor}”
          </span>
        )
      ) : null}
    </p>
  );
}

/**
 * O "Transferir para" da versão testada, já em texto. `pessoa` = há alguém
 * escolhido (vai a essa pessoa só se a conversa ainda não tiver responsável);
 * senão, a fila.
 */
export interface DestinoDaTransferencia {
  texto: string;
  pessoa: boolean;
}

/** A conversa iria para a equipe: para quem, e o que acontece com ela. */
function CartaoDaEquipe({ destino, titulo }: { destino: DestinoDaTransferencia; titulo: string }) {
  const t = useTranslations('IaAgentes');
  return (
    <Cartao icone={<UserCircle2 className="size-3" />} cor={COR.equipe} titulo={titulo}>
      <p>
        <span className="font-medium">{destino.texto}</span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {destino.pessoa ? t('playground.efeitoEquipeDetalhePessoa') : t('playground.efeitoEquipeDetalhe')}
      </p>
    </Cartao>
  );
}

/**
 * Debaixo de cada resposta: as travas (a resposta seria retida), um cartão
 * por ação que aconteceria, a passagem ou a transferência, e as recusadas.
 * `destinoDaTransferencia` é o "Transferir para" da versão testada, já em
 * texto (o nome, ou a fila).
 */
export function EfeitosDaResposta({ x, destinoDaTransferencia }: { x: RespostaDoRaioX; destinoDaTransferencia: DestinoDaTransferencia }) {
  const t = useTranslations('IaAgentes');
  if (x.retomada) return null;
  const aceitas = x.acoes?.aceitas ?? [];
  const recusadas = x.acoes?.recusadas ?? [];
  const daEquipe = aceitas.filter((a) => a.tipo === 'transferir');
  const outras = aceitas.filter((a) => a.tipo !== 'transferir');
  const retida = respostaRetida(x);
  const transfere = x.handoff === true || retida || daEquipe.length > 0;
  const nada = outras.length === 0 && recusadas.length === 0 && !transfere && !x.passaPara;

  return (
    <div className="mt-1.5 space-y-1.5 border-t border-border/50 pt-1.5 text-xs">
      {/* As travas: na produção a resposta NÃO sairia. */}
      {x.pedidoVazado ? (
        <p className="flex items-start gap-1 text-red-700">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.pedidoVazado')}</span>
        </p>
      ) : null}
      {x.linkInventado ? (
        <p className="flex items-start gap-1 text-red-700">
          <Link2Off className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.linkInventado')}</span>
        </p>
      ) : null}
      {x.reuniaoPrometida ? (
        <p className="flex items-start gap-1 text-red-700">
          <CalendarX className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.reuniaoPrometida')}</span>
        </p>
      ) : null}
      {x.acaoPrometida ? (
        <p className="flex items-start gap-1 text-red-700">
          <ClipboardX className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.acaoPrometida')}</span>
        </p>
      ) : null}
      {x.transferenciaInferida ? (
        <p className="flex items-start gap-1 text-amber-700">
          <UserCircle2 className="mt-px size-3.5 shrink-0" />
          <span>{t('playground.transferenciaInferida')}</span>
        </p>
      ) : null}

      {nada ? (
        <p className="text-[11px] text-muted-foreground">{t('playground.efeitoNenhum')}</p>
      ) : (
        <>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {x.passaPara && outras.length > 0 ? t('playground.efeitoAntesDaPassagem') : t('playground.efeitoTitulo')}
          </p>
          <ul className="space-y-1">
            {outras.map((a, i) => (
              <Cartao
                key={`${a.tipo}-${i}`}
                icone={<IconeDaAcao tipo={a.tipo} />}
                cor={corDaAcao(a.tipo)}
                titulo={efeitoDaAcao(t, a.tipo)}
                dica={fraseDaAcao(t, a.tipo, a.nome, a.valor)}
              >
                <NomeEValor tipo={a.tipo} nome={a.nome} valor={a.valor} />
              </Cartao>
            ))}
            {x.passaPara ? (
              <Cartao icone={<Bot className="size-3" />} cor={COR.etapa} titulo={t('playground.efeitoPassagem')} dica={t('playground.passaria', { agente: x.passaPara })}>
                <p>
                  <span className="font-medium">{x.passaPara}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">{t('playground.efeitoPassagemDetalhe')}</p>
              </Cartao>
            ) : null}
            {transfere ? (
              <CartaoDaEquipe
                destino={destinoDaTransferencia}
                titulo={retida ? t('playground.efeitoRetida') : efeitoDaAcao(t, 'transferir')}
              />
            ) : null}
            {recusadas.map((r, i) => (
              <Cartao
                key={`recusada-${r.tipo}-${i}`}
                icone={<Ban className="size-3" />}
                cor={COR.recusa}
                titulo={t('playground.efeitoNaoFaria', { tipo: rotuloDoTipoDeAcao(t, r.tipo) })}
              >
                <p className="text-muted-foreground">{motivoDaRecusa(t, r.motivo)}</p>
              </Cartao>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** O texto cru com os marcadores `[[…]]` destacados. */
function ComMarcadores({ texto }: { texto: string }) {
  const pedacos = texto.split(/(\[\[[^\]]*\]\])/g);
  return (
    <>
      {pedacos.map((p, i) =>
        /^\[\[[^\]]*\]\]$/.test(p) ? (
          <span key={i} className="rounded bg-primary/10 px-0.5 text-primary">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Recolhido debaixo da resposta: o raciocínio (o resumo do provedor), o que o
 * modelo escreveu com os marcadores, o que ele viu e o pedido enviado. O
 * começo do raciocínio aparece já no título, para se saber que ele está lá.
 */
export function Bastidores({ x }: { x: RespostaDoRaioX }) {
  const t = useTranslations('IaAgentes');
  const temRaciocinio = typeof x.raciocinio === 'string' && x.raciocinio.length > 0;
  const titulo = 'mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
  return (
    <details className="group mt-1.5 rounded-lg border border-border/70 bg-background/60 text-[11px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground">
        <Brain className="size-3 shrink-0" />
        <span className="shrink-0 font-medium">{t('playground.bastidores.titulo')}</span>
        {temRaciocinio ? (
          <span className="min-w-0 truncate italic group-open:hidden">“{x.raciocinio}”</span>
        ) : null}
      </summary>
      <div className="space-y-2 px-2 pb-2">
        <div>
          <p className={titulo}>{t('playground.bastidores.raciocinio')}</p>
          {temRaciocinio ? (
            <p className="mt-0.5 whitespace-pre-wrap border-l-2 border-primary/60 pl-2 text-foreground">{x.raciocinio}</p>
          ) : (
            <p className="mt-0.5 text-muted-foreground">
              {x.mostraRaciocinio === false
                ? t('playground.bastidores.raciocinioIndisponivel')
                : x.raciocinio === null
                  ? t('playground.bastidores.raciocinioVazio')
                  : t('playground.bastidores.raciocinioDesconhecido')}
            </p>
          )}
        </div>
        {x.respostaCrua !== undefined ? (
          <div>
            <p className={titulo}>{t('playground.bastidores.respostaCrua')}</p>
            <pre
              className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-1.5 text-[11px] text-foreground"
              style={{ fontFamily: FONTE_MONO }}
            >
              <ComMarcadores texto={x.respostaCrua} />
            </pre>
          </div>
        ) : null}
        {x.vistos ? (
          <div>
            <p className={titulo}>{t('playground.bastidores.viu')}</p>
            <p className="mt-0.5 flex items-start gap-1 text-foreground">
              <Eye className="mt-px size-3 shrink-0 text-muted-foreground" />
              <span>
                {[t('playground.conversa'), ...x.vistos.blocos.map((b) => rotuloDoBloco(t, b))].join(', ')} ·{' '}
                {t('playground.trechos', { n: x.vistos.trechos })}
              </span>
            </p>
          </div>
        ) : null}
        <div>
          <p className={titulo}>{t('playground.pedidoEnviado')}</p>
          {x.pedido ? (
            <details className="mt-0.5">
              <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
                <FileText className="size-3 shrink-0" /> {t('playground.bastidores.pedidoAbrir', { n: x.pedido.length })}
              </summary>
              <pre
                className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[11px] text-foreground"
                style={{ fontFamily: FONTE_MONO }}
              >
                {x.pedido}
              </pre>
            </details>
          ) : (
            <p className="mt-0.5 text-muted-foreground">{t('playground.bastidores.pedidoDica')}</p>
          )}
        </div>
      </div>
    </details>
  );
}

/** "resposta 2", que leva à bolha. */
function DaResposta({ agenteId, n }: { agenteId: string; n: number }) {
  const t = useTranslations('IaAgentes');
  return (
    <button
      type="button"
      className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => document.getElementById(idDaResposta(agenteId, n))?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
    >
      {t('playground.lead.resposta', { n })}
    </button>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-2 first:border-t-0 first:pt-0">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {children}
    </section>
  );
}

/**
 * Ao lado da conversa: a soma do que o agente teria feito no CRM. As
 * respostas vêm da conversa do Playground (nunca da comparação, que é
 * retrato); `turnos` vazio = o convite para conversar.
 */
export function PainelDoLead({
  turnos,
  agenteId,
  destinoDaResposta,
}: {
  turnos: ReadonlyArray<RespostaParaOLead & RespostaDoRaioX>;
  agenteId: string;
  /** O destino da transferência da versão que gerou cada resposta (Codex, #495). */
  destinoDaResposta: (x: RespostaDoRaioX) => DestinoDaTransferencia;
}) {
  const t = useTranslations('IaAgentes');
  const e: EstadoDoLead = estadoDoLead(turnos.map((x) => ({ ...x, retida: x.role === 'assistant' && respostaRetida(x) })));
  // A resposta em que a conversa foi para a equipe: o destino é o da versão dela.
  const respostaDoAtendimento =
    e.atendimento === null ? undefined : turnos.filter((x) => x.role === 'assistant')[e.atendimento.resposta - 1];
  const destinoDoAtendimento = respostaDoAtendimento ? destinoDaResposta(respostaDoAtendimento).texto : '';
  const nada = <p className="text-xs text-muted-foreground">{t('playground.lead.nada')}</p>;

  return (
    <aside className="min-w-0 rounded-xl border border-border bg-card p-3 lg:h-[60vh] lg:min-h-[420px] lg:overflow-y-auto">
      <p className="text-sm font-medium text-foreground">{t('playground.lead.titulo')}</p>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('playground.lead.subtitulo')}</p>
      {leadSemMudanca(e) ? (
        <p className="text-xs text-muted-foreground">
          {turnos.some((x) => x.role === 'assistant') ? t('playground.lead.semMudanca') : t('playground.lead.vazio')}
        </p>
      ) : (
        <div>
          <Bloco titulo={t('playground.lead.etapa')}>
            {e.etapa ? (
              <div className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 break-words font-medium text-foreground">{nomeDaEtapa(e.etapa.nome)}</span>
                <DaResposta agenteId={agenteId} n={e.etapa.resposta} />
              </div>
            ) : e.atendimento?.tipo === 'agente' ? (
              <p className="text-xs text-foreground">{t('playground.lead.etapaDoAgente', { agente: e.atendimento.agente ?? '' })}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('playground.lead.etapaIgual')}</p>
            )}
          </Bloco>
          <Bloco titulo={t('playground.lead.etiquetas')}>
            {e.etiquetas.length === 0 ? (
              nada
            ) : (
              <div className="flex flex-wrap gap-1">
                {e.etiquetas.map((g) => (
                  <span
                    key={g.nome}
                    className={cn(
                      'rounded-full px-2 py-px text-[11px]',
                      g.mudanca === 'aplicada' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground line-through',
                    )}
                    title={g.mudanca === 'aplicada' ? t('playground.lead.aplicada') : t('playground.lead.retirada')}
                  >
                    {g.mudanca === 'aplicada' ? '+ ' : '− '}
                    {g.nome}
                  </span>
                ))}
              </div>
            )}
          </Bloco>
          <Bloco titulo={t('playground.lead.campos', { n: e.campos.length })}>
            {e.campos.length === 0 ? (
              nada
            ) : (
              <dl className="space-y-1.5 text-xs">
                {/* O nome em cima e o valor embaixo: o valor longo (um resumo) não espreme o nome. */}
                {e.campos.map((c) => (
                  <div key={c.nome} className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <dt className="min-w-0 break-words text-[11px] text-muted-foreground">{c.nome}</dt>
                      <DaResposta agenteId={agenteId} n={c.resposta} />
                    </div>
                    <dd className="break-words font-medium text-foreground">{c.valor}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Bloco>
          <Bloco titulo={t('playground.lead.tarefas')}>
            {e.tarefas.length === 0
              ? nada
              : e.tarefas.map((x, i) => (
                  <p key={i} className="text-xs text-foreground">
                    {x.valor ? `${x.valor} · ` : ''}
                    <span className="text-muted-foreground">{t('playground.lead.tarefaPara', { nome: x.nome })}</span>
                    <DaResposta agenteId={agenteId} n={x.resposta} />
                  </p>
                ))}
          </Bloco>
          <Bloco titulo={t('playground.lead.automacoes')}>
            {e.automacoes.length === 0
              ? nada
              : e.automacoes.map((x, i) => (
                  <p key={i} className="text-xs text-foreground">
                    {x.nome}
                    <DaResposta agenteId={agenteId} n={x.resposta} />
                  </p>
                ))}
          </Bloco>
          <Bloco titulo={t('playground.lead.reuniao')}>
            {e.reunioes.length === 0
              ? nada
              : e.reunioes.map((x, i) => (
                  <p key={i} className="text-xs text-foreground">
                    {x.nome}
                    {x.valor ? <span className="text-muted-foreground"> · {x.valor}</span> : null}
                    <DaResposta agenteId={agenteId} n={x.resposta} />
                  </p>
                ))}
          </Bloco>
          <Bloco titulo={t('playground.lead.atendimento')}>
            {e.atendimento === null ? (
              <p className="text-xs text-foreground">{t('playground.lead.continuaComOAgente')}</p>
            ) : (
              <div className="text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {e.atendimento.tipo === 'agente'
                      ? t('playground.lead.passouParaOAgente', { agente: e.atendimento.agente ?? '' })
                      : t('playground.lead.passouParaAEquipe', { destino: destinoDoAtendimento })}
                  </span>
                  <DaResposta agenteId={agenteId} n={e.atendimento.resposta} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {e.atendimento.tipo === 'agente'
                    ? t('playground.lead.passouParaOAgenteDetalhe')
                    : e.atendimento.retida
                      ? t('playground.lead.retidaDetalhe')
                      : t('playground.lead.passouParaAEquipeDetalhe')}
                </p>
              </div>
            )}
          </Bloco>
        </div>
      )}
    </aside>
  );
}
