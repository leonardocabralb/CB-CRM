'use client';

// O detalhe de um agente de IA (F1b, 5.9): Configuração, Acesso e Base de
// conhecimento (F3), Ferramentas (F4, D28), Retomada (1056: voltar a falar com
// quem não respondeu), Playground, Uso e Turnos (as últimas vezes que ele foi
// chamado a responder).
//
// ⚠️ Configuração, Acesso, Base, Ferramentas, Retomada e Playground ficam MONTADAS
// depois da primeira visita (escondidas, não desmontadas): o rascunho de
// cada uma vive nela, e trocar de aba para testar no Playground apagava, sem
// aviso, o que tinha sido digitado. A aba Uso, sem rascunho, remonta a cada
// visita: montada, os testes feitos no Playground não apareciam até
// recarregar a página. A aba Turnos, pelo mesmo motivo, também remonta a cada
// visita.
//
// O PLAYGROUND TESTA O RASCUNHO (DC4 da central dos agentes, 26/10/2026):
// Configuração, Acesso, Ferramentas e Retomada avisam aqui o que o Salvar
// delas mandaria agora (`aoMudarRascunho`, carimbado com a versão do agente),
// e o Playground manda isso junto. Aba não visitada não tem rascunho. A Base
// não entra: o teste usa os documentos SALVOS (a busca é pelo id do agente).
// ⚠️ A conversa do Playground NÃO zera mais ao salvar (a `key` é só o id do
// agente): cada resposta leva o selo da versão que a gerou ("salvo às HH:MM"
// ou "rascunho"), e "Rodar o roteiro de novo" a refaz com a versão escolhida.
//
// A TELA DE MONTAR (10/11/2026, pedido do operador):
//   - o cabeçalho diz o que falta para o agente atender (instruções, chave do
//     provedor, conexão, etapa) e tem o "Ligar" — que saiu da Configuração e
//     grava NA HORA, depois de confirmar o aviso da D27 (só os cards que
//     ENTRAREM nas etapas depois disso são atendidos);
//   - as abas ficam em três grupos (montar · testar · acompanhar);
//   - UMA barra de salvar para todas as abas com rascunho: cada aba registra
//     o Salvar dela (`registrarSalvar`) e a barra chama os das abas com
//     alteração, um por vez (é o mesmo PATCH de cada aba, na mesma ordem em
//     que se clicaria); "Descartar" remonta as abas (`geracao`);
//   - sair da página com alteração não salva pergunta antes (o clique num
//     link interno é segurado; fechar ou recarregar, o aviso do navegador).

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft, Bot, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { AcessoDoAgente } from './acesso-do-agente';
import { BaseDoAgente } from './base-do-agente';
import { ConfiguracaoDoAgente } from './configuracao-do-agente';
import { FerramentasDoAgente } from './ferramentas-do-agente';
import { PlaygroundDoAgente } from './playground-do-agente';
import { RetomadaDoAgente } from './retomada-do-agente';
import { TurnosDoAgente } from './turnos-do-agente';
import { UsoDeIa } from './uso-de-ia';
import { juntarRascunhos, type RascunhoDaAba } from './rascunho';
import { buscarChaves, NOME_DO_PROVEDOR, type ChavesDaConta, type IaAgente, type SalvarDaAba } from './tipos';
import { textoDoCodigo } from './textos';

type Aba = 'configuracao' | 'acesso' | 'base' | 'ferramentas' | 'retomada' | 'playground' | 'uso' | 'turnos';

/** As abas com rascunho (e Salvar próprio), na ordem em que a barra as salva. */
const ABAS_COM_RASCUNHO = ['configuracao', 'acesso', 'base', 'ferramentas', 'retomada'] as const;
type AbaComRascunho = (typeof ABAS_COM_RASCUNHO)[number];

/** As abas, em três grupos: montar o agente, testar, acompanhar. */
const ABAS: ReadonlyArray<{ id: Aba; grupo: 'montar' | 'testar' | 'acompanhar' }> = [
  { id: 'configuracao', grupo: 'montar' },
  { id: 'acesso', grupo: 'montar' },
  { id: 'base', grupo: 'montar' },
  { id: 'ferramentas', grupo: 'montar' },
  { id: 'retomada', grupo: 'montar' },
  { id: 'playground', grupo: 'testar' },
  { id: 'uso', grupo: 'acompanhar' },
  { id: 'turnos', grupo: 'acompanhar' },
];

type Estado =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'sumiu' }
  | { fase: 'pronto'; agente: IaAgente };

/** Um item do "para atender": o que está certo, ou o que falta e onde se arruma. */
interface ItemDaProntidao {
  chave: string;
  ok: boolean;
  texto: string;
  aba: Aba;
}

export function DetalheDoAgente({ id }: { id: string }) {
  const t = useTranslations('IaAgentes');
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('configuracao');
  const [visitadas, setVisitadas] = useState<ReadonlySet<Aba>>(() => new Set<Aba>(['configuracao']));
  // Cada aba com rascunho avisa se há alteração não salva (o Playground diz quais).
  const [configuracaoNaoSalva, setConfiguracaoNaoSalva] = useState(false);
  const [acessoNaoSalvo, setAcessoNaoSalvo] = useState(false);
  const [baseNaoSalva, setBaseNaoSalva] = useState(false);
  const [ferramentasNaoSalvas, setFerramentasNaoSalvas] = useState(false);
  const [retomadaNaoSalva, setRetomadaNaoSalva] = useState(false);
  // O que o Salvar de cada aba mandaria agora: o RASCUNHO que o Playground testa (DC4).
  const [rascunhoDaConfiguracao, setRascunhoDaConfiguracao] = useState<RascunhoDaAba | null>(null);
  const [rascunhoDoAcesso, setRascunhoDoAcesso] = useState<RascunhoDaAba | null>(null);
  const [rascunhoDasFerramentas, setRascunhoDasFerramentas] = useState<RascunhoDaAba | null>(null);
  const [rascunhoDaRetomada, setRascunhoDaRetomada] = useState<RascunhoDaAba | null>(null);
  // O cliente do teste do Playground (F3) mora aqui.
  const [contatoDoTeste, setContatoDoTeste] = useState('');
  // A barra de salvar (10/11/2026): o Salvar de cada aba, e o "Descartar".
  // (Um `useCallback` por aba: o ref só é tocado quando a aba chama, nunca no render.)
  const salvadores = useRef<Partial<Record<AbaComRascunho, SalvarDaAba>>>({});
  const registrarConfiguracao = useCallback((fn: SalvarDaAba | null) => {
    salvadores.current.configuracao = fn ?? undefined;
  }, []);
  const registrarAcesso = useCallback((fn: SalvarDaAba | null) => {
    salvadores.current.acesso = fn ?? undefined;
  }, []);
  const registrarBase = useCallback((fn: SalvarDaAba | null) => {
    salvadores.current.base = fn ?? undefined;
  }, []);
  const registrarFerramentas = useCallback((fn: SalvarDaAba | null) => {
    salvadores.current.ferramentas = fn ?? undefined;
  }, []);
  const registrarRetomada = useCallback((fn: SalvarDaAba | null) => {
    salvadores.current.retomada = fn ?? undefined;
  }, []);
  const [geracao, setGeracao] = useState(0);
  const [salvandoTudo, setSalvandoTudo] = useState(false);
  // O link interno que a pessoa clicou com alteração não salva (a pergunta).
  const [saidaPendente, setSaidaPendente] = useState<string | null>(null);
  // "Ligar"/"Desligar" à espera da confirmação (o aviso da D27).
  const [mudandoLigado, setMudandoLigado] = useState<boolean | null>(null);
  const [gravandoLigado, setGravandoLigado] = useState(false);
  const [chaves, setChaves] = useState<ChavesDaConta>(null);

  function trocarDeAba(nova: Aba) {
    setAba(nova);
    setVisitadas((v) => (v.has(nova) ? v : new Set([...v, nova])));
  }
  // O estado carrega DE QUEM é (efeito passivo: trocar de agente pela URL não
  // pode mostrar o anterior por um quadro).
  const [estado, setEstado] = useState<{ de: string; e: Estado }>({ de: id, e: { fase: 'carregando' } });

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/cb/ia/agentes/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        setEstado({ de: id, e: { fase: 'sumiu' } });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { agente: IaAgente };
      setEstado({ de: id, e: { fase: 'pronto', agente: corpo.agente } });
    } catch {
      setEstado({ de: id, e: { fase: 'falhou' } });
    }
  }, [id]);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  // As chaves da conta: o cabeçalho diz quando o provedor do agente não tem
  // chave (nulo = não se sabe — nunca vira "sem chave").
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const c = await buscarChaves();
      if (vivo) setChaves(c);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const e: Estado = estado.de === id ? estado.e : { fase: 'carregando' };

  function aoSalvarAgente(novo: IaAgente) {
    setEstado({ de: id, e: { fase: 'pronto', agente: novo } });
  }

  // Só os rascunhos calculados sobre a versão ATUAL do agente (efeito
  // passivo: logo depois de salvar, a aba ainda não reavisou).
  const rascunho =
    e.fase === 'pronto'
      ? juntarRascunhos(e.agente.updatedAt, [
          rascunhoDaConfiguracao,
          rascunhoDoAcesso,
          rascunhoDasFerramentas,
          rascunhoDaRetomada,
        ])
      : null;

  const sujas: Record<AbaComRascunho, boolean> = {
    configuracao: configuracaoNaoSalva,
    acesso: acessoNaoSalvo,
    base: baseNaoSalva,
    ferramentas: ferramentasNaoSalvas,
    retomada: retomadaNaoSalva,
  };
  const naoSalvoEm = ABAS_COM_RASCUNHO.filter((a) => sujas[a]).map((a) => t(`detalhe.${a}`));
  const temNaoSalvo = naoSalvoEm.length > 0;

  // Sair com alteração não salva: o link interno pergunta antes; fechar ou
  // recarregar a aba, o aviso do navegador. (Voltar pelo histórico não é
  // segurado — limite aceito.)
  useEffect(() => {
    if (!temNaoSalvo) return;
    const antesDeSair = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    const aoClicar = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const alvo = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
      if (!(alvo instanceof HTMLAnchorElement) || alvo.target === '_blank' || alvo.hasAttribute('download')) return;
      const url = new URL(alvo.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      ev.preventDefault();
      ev.stopPropagation();
      setSaidaPendente(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', antesDeSair);
    document.addEventListener('click', aoClicar, true);
    return () => {
      window.removeEventListener('beforeunload', antesDeSair);
      document.removeEventListener('click', aoClicar, true);
    };
  }, [temNaoSalvo]);

  /** Salva as abas com alteração, uma por vez; para na primeira que falhar e a mostra. */
  async function salvarTudo() {
    setSalvandoTudo(true);
    try {
      for (const a of ABAS_COM_RASCUNHO) {
        if (!sujas[a]) continue;
        const salvar = salvadores.current[a];
        if (!salvar) continue;
        if (!(await salvar())) {
          trocarDeAba(a);
          return;
        }
      }
    } finally {
      setSalvandoTudo(false);
    }
  }

  function descartar() {
    // Remontar as abas com rascunho as devolve ao salvo (cada uma reavisa
    // "nada mudou" e o rascunho nulo).
    setGeracao((g) => g + 1);
  }

  async function gravarLigado(ligar: boolean) {
    if (e.fase !== 'pronto') return;
    setGravandoLigado(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${e.agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: ligar }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string; error?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        return;
      }
      toast.success(ligar ? t('detalhe.ligar.ligado') : t('detalhe.ligar.desligado'));
      aoSalvarAgente(corpo.agente);
      setMudandoLigado(null);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setGravandoLigado(false);
    }
  }

  const prontidao: ItemDaProntidao[] =
    e.fase === 'pronto'
      ? [
          {
            chave: 'instrucoes',
            ok: e.agente.instrucoes.trim().length > 0,
            texto: e.agente.instrucoes.trim() ? t('detalhe.prontidao.instrucoes') : t('detalhe.prontidao.semInstrucoes'),
            aba: 'configuracao',
          },
          {
            chave: 'modelo',
            // Leitura das chaves que falhou (nulo) não acusa nada.
            ok: chaves === null || chaves[e.agente.provedor],
            texto:
              chaves !== null && !chaves[e.agente.provedor]
                ? t('detalhe.prontidao.semChave', { provedor: NOME_DO_PROVEDOR[e.agente.provedor] })
                : e.agente.modelo,
            aba: 'configuracao',
          },
          {
            chave: 'conexoes',
            ok: e.agente.conexoes.length > 0,
            texto:
              e.agente.conexoes.length > 0
                ? t('detalhe.prontidao.conexoes', { n: e.agente.conexoes.length })
                : t('detalhe.prontidao.semConexao'),
            aba: 'configuracao',
          },
          {
            chave: 'etapas',
            ok: e.agente.etapas.length > 0,
            texto:
              e.agente.etapas.length > 0
                ? t('detalhe.prontidao.etapas', { n: e.agente.etapas.length })
                : t('detalhe.prontidao.semEtapa'),
            aba: 'configuracao',
          },
        ]
      : [];
  const faltando = prontidao.filter((p) => !p.ok);

  return (
    <div className="space-y-4">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t('detalhe.voltar')}
      </Link>

      {e.fase === 'carregando' ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : e.fase === 'sumiu' ? (
        <p className="text-sm text-muted-foreground">{t('detalhe.sumiu')}</p>
      ) : e.fase === 'falhou' ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('detalhe.falhou')}</p>
          <Button variant="outline" size="sm" onClick={() => void carregar()}>
            <RefreshCw className="size-4" /> {t('tentarDeNovo')}
          </Button>
        </div>
      ) : (
        <>
          {/* O cabeçalho: nome, situação, o que falta para atender e o "Ligar". */}
          <div className="space-y-2">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="size-5 shrink-0 text-primary" />
                <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">{e.agente.nome}</h2>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                    e.agente.ativo
                      ? 'border-emerald-600/30 text-emerald-700'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', e.agente.ativo ? 'bg-emerald-600' : 'bg-muted-foreground/60')} />
                  {e.agente.ativo ? t('detalhe.ligar.estadoLigado') : t('detalhe.ligar.estadoDesligado')}
                </span>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
                {t('detalhe.ligar.rotulo')}
                <Switch
                  checked={e.agente.ativo}
                  disabled={gravandoLigado}
                  onCheckedChange={(v) => setMudandoLigado(v === true)}
                  aria-label={t('detalhe.ligar.rotulo')}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border py-2 text-xs">
              <span className="font-medium text-foreground">
                {faltando.length === 0
                  ? t('detalhe.prontidao.pronto')
                  : t('detalhe.prontidao.falta', { n: faltando.length })}
              </span>
              {prontidao.map((p) =>
                p.ok ? (
                  <span key={p.chave} className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{p.texto}</span>
                  </span>
                ) : (
                  <button
                    key={p.chave}
                    type="button"
                    onClick={() => trocarDeAba(p.aba)}
                    className="inline-flex min-w-0 items-center gap-1 text-amber-700 underline-offset-2 hover:underline"
                  >
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span className="truncate">{p.texto}</span>
                  </button>
                ),
              )}
            </div>
          </div>

          {/* As abas, em três grupos separados por um traço: montar · testar · acompanhar. */}
          <nav aria-label={t('detalhe.abas')} className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-border">
            {ABAS.map((a, i) => (
              <span key={a.id} className="flex items-end gap-4">
                {i > 0 && ABAS[i - 1].grupo !== a.grupo ? (
                  <span aria-hidden className="mb-2.5 h-4 w-px bg-border" />
                ) : null}
                <button
                  type="button"
                  onClick={() => trocarDeAba(a.id)}
                  aria-current={aba === a.id ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm whitespace-nowrap',
                    aba === a.id
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`detalhe.${a.id}`)}
                  {(ABAS_COM_RASCUNHO as readonly string[]).includes(a.id) && sujas[a.id as AbaComRascunho] ? (
                    <span className="size-1.5 rounded-full bg-amber-500" title={t('detalhe.salvar.naoSalvoNaAba')} />
                  ) : null}
                </button>
              </span>
            ))}
          </nav>

          <div hidden={aba !== 'configuracao'}>
            <ConfiguracaoDoAgente
              key={`${e.agente.id}-${geracao}`}
              agente={e.agente}
              aoSalvar={aoSalvarAgente}
              aoMudarNaoSalvo={setConfiguracaoNaoSalva}
              aoMudarRascunho={setRascunhoDaConfiguracao}
              registrarSalvar={registrarConfiguracao}
            />
          </div>
          {visitadas.has('acesso') ? (
            <div hidden={aba !== 'acesso'}>
              <AcessoDoAgente
                key={`${e.agente.id}-${geracao}`}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setAcessoNaoSalvo}
                aoMudarRascunho={setRascunhoDoAcesso}
                registrarSalvar={registrarAcesso}
              />
            </div>
          ) : null}
          {visitadas.has('base') ? (
            <div hidden={aba !== 'base'}>
              <BaseDoAgente
                key={`${e.agente.id}-${geracao}`}
                agenteId={e.agente.id}
                aoMudarNaoSalvo={setBaseNaoSalva}
                registrarSalvar={registrarBase}
              />
            </div>
          ) : null}
          {visitadas.has('ferramentas') ? (
            <div hidden={aba !== 'ferramentas'}>
              <FerramentasDoAgente
                key={`${e.agente.id}-${geracao}`}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setFerramentasNaoSalvas}
                aoMudarRascunho={setRascunhoDasFerramentas}
                registrarSalvar={registrarFerramentas}
              />
            </div>
          ) : null}
          {visitadas.has('retomada') ? (
            <div hidden={aba !== 'retomada'}>
              <RetomadaDoAgente
                key={`${e.agente.id}-${geracao}`}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setRetomadaNaoSalva}
                aoMudarRascunho={setRascunhoDaRetomada}
                registrarSalvar={registrarRetomada}
              />
            </div>
          ) : null}
          {visitadas.has('playground') ? (
            <div hidden={aba !== 'playground'}>
              <PlaygroundDoAgente
                key={e.agente.id}
                agente={e.agente}
                rascunho={rascunho}
                naoSalvoEm={naoSalvoEm}
                baseNaoSalva={baseNaoSalva}
                contatoId={contatoDoTeste}
                aoMudarContato={setContatoDoTeste}
              />
            </div>
          ) : null}
          {aba === 'uso' ? <UsoDeIa key={e.agente.id} agenteId={e.agente.id} /> : null}
          {aba === 'turnos' ? <TurnosDoAgente key={e.agente.id} agenteId={e.agente.id} /> : null}

          {/* UMA barra de salvar para as abas com rascunho (10/11/2026). */}
          {temNaoSalvo ? (
            <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/40 bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
              <span className="min-w-0 text-sm text-foreground">
                {t('detalhe.salvar.naoSalvo', { abas: naoSalvoEm.join(', ') })}
              </span>
              <span className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" disabled={salvandoTudo} onClick={descartar}>
                  {t('detalhe.salvar.descartar')}
                </Button>
                <Button size="sm" disabled={salvandoTudo} onClick={() => void salvarTudo()}>
                  {salvandoTudo ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('detalhe.salvar.salvar')}
                </Button>
              </span>
            </div>
          ) : null}

          {/* Ligar ou desligar: grava na hora, depois do aviso da D27. */}
          <Dialog open={mudandoLigado !== null} onOpenChange={(o) => !o && !gravandoLigado && setMudandoLigado(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {mudandoLigado ? t('detalhe.ligar.tituloLigar') : t('detalhe.ligar.tituloDesligar')}
                </DialogTitle>
                <DialogDescription>
                  {mudandoLigado ? t('campo.ativoLigando') : t('campo.ativoDesligando')}
                </DialogDescription>
              </DialogHeader>
              {mudandoLigado && faltando.length > 0 ? (
                <p className="text-sm text-amber-700">
                  {t('detalhe.ligar.aindaFalta', { itens: faltando.map((p) => p.texto).join(', ') })}
                </p>
              ) : null}
              {mudandoLigado && configuracaoNaoSalva ? (
                <p className="text-sm text-muted-foreground">{t('detalhe.ligar.configuracaoNaoSalva')}</p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" disabled={gravandoLigado} onClick={() => setMudandoLigado(null)}>
                  {t('cancelar')}
                </Button>
                <Button disabled={gravandoLigado} onClick={() => void gravarLigado(mudandoLigado === true)}>
                  {gravandoLigado ? <Loader2 className="size-4 animate-spin" /> : null}
                  {mudandoLigado ? t('detalhe.ligar.confirmarLigar') : t('detalhe.ligar.confirmarDesligar')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Sair com alteração não salva. */}
          <Dialog open={saidaPendente !== null} onOpenChange={(o) => !o && setSaidaPendente(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('detalhe.sair.titulo')}</DialogTitle>
                <DialogDescription>{t('detalhe.sair.texto', { abas: naoSalvoEm.join(', ') })}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSaidaPendente(null)}>
                  {t('detalhe.sair.ficar')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const destino = saidaPendente;
                    setSaidaPendente(null);
                    if (destino) router.push(destino);
                  }}
                >
                  {t('detalhe.sair.sair')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
