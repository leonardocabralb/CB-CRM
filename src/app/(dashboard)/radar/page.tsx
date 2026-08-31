'use client';

// ============================================================
// O Radar de Atendimento — a resposta a "qual conversa eu olho primeiro?".
//
// Lê o que o worker gravou (cb_conversation_insights) e ordena por
// severidade + recência. Não substitui o inbox: daqui o operador SALTA
// para a conversa (`/inbox?c=`); aqui ele decide para onde olhar.
//
// Princípios que a tela sustenta:
//   - todo sinal exibe a EVIDÊNCIA (trecho da mensagem) — sinal sem
//     evidência nem chega aqui, o parser da rubrica descarta;
//   - SÓ ENTRA AQUI QUEM TEM GATILHO (`temGatilho`) — a tela é a lista
//     dos problemas, não das conversas. A análise da conversa saudável
//     continua gravada (a nota média sai dela), mas não vira trabalho;
//   - "tratado/descartado" tira da frente sem apagar (anti fadiga de
//     alarme; o descarte é o dado de calibração);
//   - a pendência ("aguardando há X") é calculada AO VIVO em horas
//     úteis — o valor gravado no banco envelhece entre análises.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
  Frown,
  Loader2,
  RefreshCw,
  Scale,
  Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { ChannelCell } from '@/components/channels/channel-badge';
import { ChannelFilter } from '@/components/channels/channel-filter';
import { ComoFunciona } from '@/components/radar/como-funciona';
import type { CbChannel } from '@/lib/cb-channels/repo';
import { useCan } from '@/hooks/use-can';
import { useChannels } from '@/hooks/use-channels';
import {
  useAcoesDoRadar,
  useRadar,
  type InsightDaConta,
} from '@/hooks/use-radar';
import {
  formatarDuracaoUtil,
  segundosUteisEntre,
} from '@/lib/cb-radar/horario-comercial';
import {
  JANELA_DIAS,
  LIMIAR_ALARME_MS,
  LIMIAR_PENDENCIA_SEG,
  ordenarPorSeveridade,
  resumirCartoes,
  temGatilho,
  type InsightParaOrdenacao,
} from '@/lib/cb-radar/ordenacao';
import type { Evidencia } from '@/lib/cb-radar/rubrica';
import { cn } from '@/lib/utils';

const MS_JANELA = JANELA_DIAS * 86_400_000;

/** Os motivos tipados de `ErroDoRadar` — cada um tem chave `erro_<motivo>`
 *  no dicionário; slug desconhecido cai no `acaoFalhou` genérico. */
const MOTIVOS_DE_ERRO = [
  'conversa_nao_encontrada',
  'grupo_fora_do_radar',
  'conversa_sem_canal',
  'radar_desligado_no_canal',
  'ja_em_analise',
] as const;

/** Um insight decorado UMA vez por render com tudo que ordenação, cartões
 *  e a própria linha precisam — a transformada de Schwartz que evita
 *  recalcular `segundosUteisEntre` por comparação. */
interface Decorado {
  insight: InsightDaConta;
  ord: InsightParaOrdenacao;
  aguardandoSeg: number | null;
  /** Conversa parada além da janela, mantida só pela pendência aberta. */
  foraDaJanela: boolean;
}

export default function RadarPage() {
  const t = useTranslations('Radar');
  const {
    insights,
    carregando,
    falhou,
    estourouOTeto,
    ultimoCicloRadar,
    respondidas,
    recarregar,
  } = useRadar();
  const { channels } = useChannels();
  const podeAgir = useCan('send-messages');
  const { ocupada, mudarEstado, reanalisar } = useAcoesDoRadar(recarregar);
  const [canalFiltro, setCanalFiltro] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  /**
   * Cartões tratados/descartados NESTA visita à tela — continuam listados,
   * apagados e com o botão "Reabrir".
   *
   * ⚠️ Sem isto o botão "Reabrir" era CÓDIGO MORTO: a lista só aceita
   * `estado === 'aberto'`, então o cartão sumia no instante do clique e
   * levava junto o único botão que o traria de volta. Sobrava o "Desfazer"
   * do toast, que expira em ~4s — e `descartado` NUNCA reabre sozinho, por
   * desenho. Um clique errado escondia o alarme daquele cliente da equipe
   * inteira, para sempre.
   *
   * O conjunto vive só enquanto a tela está montada: sair e voltar limpa,
   * que é o "fim do expediente de triagem" e mantém a decisão do operador
   * de não ter uma aba "Todos".
   */
  const [mexidasAqui, setMexidasAqui] = useState<ReadonlySet<string>>(new Set());
  // Relógio vivo: numa aba deixada aberta "de olho", sem o tick os
  // cartões e o "aguardando há X" congelariam no instante do último
  // render — a tela contradizia a si mesma na fronteira do limiar.
  const [, setTique] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTique((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const mostrarCanal = channels.length > 1;
  // UM relógio por render, para tudo — três `new Date()` espalhados em
  // memos davam três respostas diferentes na mesma tela.
  const agora = new Date();

  // Opt-in vale também na LEITURA: canal com Radar desligado sai da tela
  // (o caso nomeado na 941 é o canal pessoal ligado por engano — desligar
  // tem de sumir com as análises antigas dele, não só parar as novas).
  const canalDesligado = new Map(channels.map((c) => [c.id, c.radar_enabled !== true]));

  const decorados: Decorado[] = [];
  for (const i of insights) {
    const atividadeMs = i.conversation?.last_message_at
      ? Date.parse(i.conversation.last_message_at)
      : null;
    if (!atividadeMs) continue;
    if (i.channel_id && canalDesligado.get(i.channel_id)) continue;
    if (canalFiltro && i.channel_id !== canalFiltro) continue;

    // Fora da janela do Radar = fora do painel, a MESMA régua do worker —
    // COM UMA exceção: pendência aberta. Cliente esquecido há 10 dias é o
    // pior caso do produto, e sumir com ele no 8º dia era apagar o alarme
    // exatamente quando ele fica mais grave. A análise congelada segue
    // FIEL numa conversa parada (nada aconteceu para mudá-la; a primeira
    // resposta reativa a conversa e o worker refaz tudo) — mas os cartões
    // ignoram os sinais dela via `foraDaJanela` (só a pendência conta), e
    // um "aguardando" tratado/descartado continua saindo da tela.
    const foraDaJanela = agora.getTime() - atividadeMs > MS_JANELA;
    // ⚠️ `mexidasAqui` segura o cartão AQUI também, não só em `visiveis`:
    // o cartão da pendência congelada só está na lista por `estado='aberto'`,
    // então tratá-lo/descartá-lo o derrubava neste continue e o "Reabrir"
    // não o alcançava — justamente no cliente esquecido, onde `descartado`
    // nunca reabre sozinho (a conversa está parada; não vem mensagem nova).
    if (
      foraDaJanela &&
      !(i.aguardando_desde && i.estado === 'aberto') &&
      !mexidasAqui.has(i.conversation_id)
    ) {
      continue;
    }

    // ⚠️ A pendência morre quando GENTE responde, e o painel descobre isso
    // ao vivo (`respondidas`) — o `aguardando_desde` da linha é o retrato
    // da última análise e só é reescrito quando o worker volta, dois
    // atrasos depois. Sem esta linha o cartão seguia na tela contando
    // "aguardando há 26h" sobre um cliente já atendido.
    const pendenciaViva =
      i.aguardando_desde && !respondidas.has(i.conversation_id)
        ? new Date(i.aguardando_desde)
        : null;
    const aguardandoSeg = pendenciaViva
      ? segundosUteisEntre(pendenciaViva, agora)
      : null;
    const aguardandoMsCorridos = pendenciaViva
      ? agora.getTime() - pendenciaViva.getTime()
      : null;
    decorados.push({
      insight: i,
      aguardandoSeg,
      foraDaJanela,
      ord: {
        urgencia: i.urgencia,
        insatisfacao: i.insatisfacao,
        pedidosAbertos: i.pedidos_abertos,
        aguardandoSegUteis: aguardandoSeg,
        aguardandoMsCorridos,
        nota: i.nota,
        estado: i.estado,
        ultimaAtividade: new Date(atividadeMs),
        foraDaJanela,
      },
    });
  }

  // Os cartões-resumo leem TODOS os decorados, não só os visíveis: a nota
  // média é da semana inteira e não pode depender de quem tem alarme.
  const cartoes = resumirCartoes(decorados.map((d) => d.ord));
  const ordenados = ordenarPorSeveridade(decorados, (d) => d.ord, agora);
  // A regra da tela: aberto E (com gatilho OU com a análise quebrada).
  // Análise de conversa saudável fica no banco, fora do caminho de quem
  // trabalha.
  //
  // ⚠️ `status === 'failed'` entra INDEPENDENTE de gatilho. A linha que
  // esgotou as 3 tentativas nunca preencheu sinal nenhum — fica com os
  // defaults do schema (`urgencia='nenhuma'`, sem insatisfação, sem
  // pedido) —, então o filtro a esconderia e o vazio afirmaria "nenhum
  // sinal aberto" sobre uma conversa que o Radar NÃO CONSEGUIU LER. Com
  // ela fora da lista, a etiqueta `analiseFalhou` e o botão "Reanalisar"
  // ficariam inalcançáveis, e a falha viraria silêncio permanente — a
  // mesma armadilha que o hook já evita ao separar `falhou` de "vazio".
  const visiveis = ordenados.filter(
    (d) =>
      (d.insight.estado === 'aberto' || mexidasAqui.has(d.insight.conversation_id)) &&
      (temGatilho(d.ord) || d.insight.status === 'failed'),
  );
  // Separado de `visiveis` para o vazio saber distinguir "nada analisado"
  // de "analisado e sem problema nenhum" — dizem coisas opostas.
  const nAnalisados = decorados.length;

  // Saúde do ciclo: o epoch semeado na 941 = "nunca rodou" (o agendador
  // da VPS ainda não bate na rota — o passo manual do runbook); parado
  // além de 3 ciclos = quebrou depois de funcionar.
  const cicloTs = ultimoCicloRadar ? Date.parse(ultimoCicloRadar) : NaN;
  const cicloRecado = !Number.isFinite(cicloTs)
    ? null
    : cicloTs < Date.parse('2001-01-01T00:00:00Z')
      ? ({ tipo: 'nunca' } as const)
      : agora.getTime() - cicloTs > 45 * 60_000
        ? ({ tipo: 'parado', min: Math.round((agora.getTime() - cicloTs) / 60_000) } as const)
        : null;

  const agir = useCallback(
    async (acao: Promise<{ ok: boolean; erro?: string }>) => {
      const r = await acao;
      if (r.ok) return true;
      const erro = r.erro ?? '?';
      toast.error(
        (MOTIVOS_DE_ERRO as readonly string[]).includes(erro)
          ? t(`erro_${erro}`)
          : t('acaoFalhou', { erro }),
      );
      return false;
    },
    [t],
  );

  /**
   * Tratar/descartar COM desfazer.
   *
   * Duas saídas para o clique errado, de propósito: o "Desfazer" do toast
   * (imediato) e o cartão que FICA na lista, apagado, com o botão
   * "Reabrir" — ver `mexidasAqui`. Descartar é "a IA errou aqui" e nunca
   * reabre sozinho; com uma saída só, e ela durando 4 segundos, um engano
   * escondia o alarme daquele cliente para sempre.
   */
  const reabrir = useCallback(
    async (conversationId: string) => {
      if (!(await agir(mudarEstado(conversationId, 'aberto')))) return;
      setMexidasAqui((antes) => {
        const proximo = new Set(antes);
        proximo.delete(conversationId);
        return proximo;
      });
    },
    [agir, mudarEstado],
  );

  const mudar = useCallback(
    async (conversationId: string, estado: 'aberto' | 'tratado' | 'descartado') => {
      if (estado === 'aberto') return reabrir(conversationId);
      // ⚠️ O carimbo da análise QUE ESTÁ NA TELA viaja junto — é a trava
      // otimista da rota contra o worker reanalisar no intervalo de até 2
      // min da foto. 409 `analysis_changed` = "o Radar releu a conversa":
      // recarrega e avisa em vez de esconder um sinal que ninguém viu.
      const visto =
        insights.find((i) => i.conversation_id === conversationId)?.analisado_em ??
        null;
      const r = await mudarEstado(conversationId, estado, visto);
      if (!r.ok) {
        if (r.erro === 'analysis_changed') {
          toast.error(t('analiseMudou'));
          recarregar();
          return;
        }
        const erro = r.erro ?? '?';
        toast.error(
          (MOTIVOS_DE_ERRO as readonly string[]).includes(erro)
            ? t(`erro_${erro}`)
            : t('acaoFalhou', { erro }),
        );
        return;
      }
      setMexidasAqui((antes) => new Set(antes).add(conversationId));
      toast.success(t(estado === 'tratado' ? 'tratadoOk' : 'descartadoOk'), {
        action: { label: t('desfazer'), onClick: () => void reabrir(conversationId) },
      });
    },
    [insights, mudarEstado, reabrir, recarregar, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Scale className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ComoFunciona />
          <ChannelFilter
            channels={channels}
            value={canalFiltro}
            onChange={setCanalFiltro}
          />
        </div>
      </div>

      {/* Cartões-resumo: a visão de 5 segundos. Contam só o ABERTO — o
          tratado saiu da frente de propósito. A nota média é da janela
          inteira (tratar um sinal não melhora a semana). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          icone={AlertTriangle}
          rotulo={t('cardUrgencias')}
          valor={String(cartoes.urgencias)}
          alerta={cartoes.urgencias > 0}
        />
        <Cartao
          icone={Frown}
          rotulo={t('cardInsatisfacoes')}
          valor={String(cartoes.insatisfacoes)}
          alerta={cartoes.insatisfacoes > 0}
        />
        <Cartao
          icone={Clock}
          // A constante REAL viaja para o rótulo (regra da casa: número
          // digitado no dicionário mente na primeira mudança do limiar).
          rotulo={t('cardPendencias', { horas: LIMIAR_ALARME_MS / 3_600_000 })}
          valor={String(cartoes.pendencias)}
          alerta={cartoes.pendencias > 0}
        />
        <Cartao
          icone={Star}
          rotulo={t('cardNotaMedia')}
          valor={cartoes.notaMedia === null ? '—' : String(cartoes.notaMedia)}
          alerta={false}
        />
      </div>

      {falhou && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('loadFailed')}
          <button
            type="button"
            onClick={recarregar}
            className="ml-auto underline underline-offset-2"
          >
            {t('tentarDeNovo')}
          </button>
        </div>
      )}

      {estourouOTeto && (
        <p className="text-xs text-muted-foreground">{t('estourouOTeto')}</p>
      )}

      {/* Saúde do ciclo — sem isto, "agendador parado" e "semana calma"
          pintavam a mesma tela, e o passo manual da VPS (runbook) é
          exatamente o que mais provavelmente falta num deploy novo. */}
      {cicloRecado && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {cicloRecado.tipo === 'nunca'
              ? t('cicloNuncaRodou')
              : t('cicloParado', { min: cicloRecado.min })}
          </p>
        </div>
      )}

      {/* ⚠️ Chave de IA ausente é problema de CONTA, não de conversa — um
          cartão por linha `sem_ia` seria o ruído que o filtro matou, e
          NENHUM cartão era o oposto: a chave rotacionada silenciava a
          análise e o painel seguia com cara de saudável, só com as
          métricas (ledger 48h). Um aviso único, no padrão do recado de
          ciclo, apontando para onde se conserta. */}
      {decorados.some((d) => d.insight.detalhes?.sem_ia && !d.foraDaJanela) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {t('semIaAviso')}{' '}
            <Link href="/settings?tab=integracoes" className="underline underline-offset-2">
              {t('semIaAvisoLink')}
            </Link>
          </p>
        </div>
      )}

      {/* A aba "Todos" foi removida em 2026-08-30 (decisão do operador):
          listar toda conversa analisada era o próprio ruído que o painel
          passou a filtrar. O que ficou de fora — análise sem gatilho,
          tratada ou descartada — segue no banco e continua alimentando os
          cartões acima. */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <p className="text-sm font-medium text-foreground">
          {/* ⚠️ Conta só o que ainda está ABERTO, não o tamanho da lista: o
              cartão tratado/descartado continua listado (ver `mexidasAqui`) e
              somá-lo faria o título dizer "3 sinais abertos" com um deles
              marcado como descartado logo abaixo. */}
          {t('listaTitulo', { n: visiveis.filter((d) => d.insight.estado === 'aberto').length })}
        </p>
      </div>

      {carregando ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visiveis.length === 0 && !falhou ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {/* ⚠️ A base é a lista FILTRADA (decorados), não a bruta: com o
              filtro num canal nunca analisado, a bruta dizia "tudo
              tratado" — afirmando em dia um canal que nunca rodou. */}
          {nAnalisados === 0 ? (
            <>
              <p className="font-medium text-foreground">{t('vazioTitulo')}</p>
              <p className="mx-auto mt-2 max-w-md">{t('vazioNuncaAnalisado')}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">{t('vazioSemSinal')}</p>
              <p className="mx-auto mt-2 max-w-md">
                {t('vazioSemSinalDetalhe', { n: nAnalisados })}
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map(({ insight: i, aguardandoSeg, foraDaJanela, ord }) => (
            <LinhaDoRadar
              key={i.id}
              insight={i}
              aguardandoSeg={aguardandoSeg}
              esperaEmAlarme={(ord.aguardandoMsCorridos ?? 0) >= LIMIAR_ALARME_MS}
              foraDaJanela={foraDaJanela}
              mostrarCanal={mostrarCanal}
              canais={channels}
              podeAgir={podeAgir}
              ocupada={ocupada === i.conversation_id}
              expandida={expandida === i.id}
              aoExpandir={() => setExpandida((atual) => (atual === i.id ? null : i.id))}
              aoMudarEstado={(estado) => void mudar(i.conversation_id, estado)}
              aoReanalisar={() => agir(reanalisar(i.conversation_id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Cartao({
  icone: Icone,
  rotulo,
  valor,
  alerta,
}: {
  icone: typeof AlertTriangle;
  rotulo: string;
  valor: string;
  alerta: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icone className={cn('h-3.5 w-3.5', alerta && 'text-amber-500')} />
        {rotulo}
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          alerta ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
        )}
      >
        {valor}
      </p>
    </div>
  );
}

const COR_URGENCIA: Record<string, string> = {
  alta: 'border-destructive/40 bg-destructive/10 text-destructive',
  media: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  baixa: 'border-border bg-muted text-muted-foreground',
};

function Etiqueta({
  className,
  title,
  children,
}: {
  className?: string;
  /** Tooltip nativo — a explicação curta de por que o selo está ali. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className ?? 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function CorDaNota(nota: number): string {
  if (nota >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (nota >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

function LinhaDoRadar({
  insight: i,
  aguardandoSeg,
  esperaEmAlarme,
  foraDaJanela,
  mostrarCanal,
  canais,
  podeAgir,
  ocupada,
  expandida,
  aoExpandir,
  aoMudarEstado,
  aoReanalisar,
}: {
  insight: InsightDaConta;
  /** Já em segundos ÚTEIS, calculado uma vez no passe decorado do pai. */
  aguardandoSeg: number | null;
  /** A espera passou de `LIMIAR_ALARME_MS` (24h CORRIDAS) — é ela que
   *  sustenta o cartão sozinha, então ganha destaque. Abaixo disso a
   *  etiqueta ainda aparece, mas como contexto de um cartão que existe
   *  por outro motivo. */
  esperaEmAlarme: boolean;
  /** Conversa parada além da janela, viva só pela pendência aberta. */
  foraDaJanela: boolean;
  mostrarCanal: boolean;
  canais: CbChannel[];
  podeAgir: boolean;
  ocupada: boolean;
  expandida: boolean;
  aoExpandir: () => void;
  aoMudarEstado: (estado: 'aberto' | 'tratado' | 'descartado') => void;
  aoReanalisar: () => void;
}) {
  const t = useTranslations('Radar');
  // Feedback por atendente é avaliação de PESSOA — só quem gerencia a
  // equipe (admin/dono) VÊ NA TELA; o restante do cartão é igual para
  // todos. ⚠️ Isto é arrumação de interface, não barreira: o dado viaja
  // em `detalhes.analise` para qualquer membro (ver CLAUDE.md, pendência
  // da migration 943 para a barreira real).
  const podeVerEquipe = useCan('manage-members');
  const contato = i.conversation?.contact;
  const nome = contato?.name || contato?.phone || t('contatoSemNome');
  const detalhes = i.detalhes;
  const analise = detalhes?.analise ?? null;
  const processos = detalhes?.processos ?? [];

  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3',
        i.estado !== 'aberto' && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={aoExpandir}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expandida}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              expandida && 'rotate-180',
            )}
          />
          <span className="truncate text-sm font-medium text-foreground">{nome}</span>
          {mostrarCanal && (
            <ChannelCell channelId={i.channel_id} channels={canais} />
          )}
        </button>
        {i.nota !== null && (
          <span
            className={cn('text-sm font-semibold tabular-nums', CorDaNota(i.nota))}
            title={t('notaTitulo')}
          >
            {t('nota', { nota: i.nota })}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {i.urgencia !== 'nenhuma' && (
          <Etiqueta className={COR_URGENCIA[i.urgencia]}>
            <AlertTriangle className="h-3 w-3" />
            {t(`urgencia_${i.urgencia}`)}
          </Etiqueta>
        )}
        {i.insatisfacao && (
          <Etiqueta className={COR_URGENCIA.media}>
            <Frown className="h-3 w-3" />
            {t('insatisfacao')}
          </Etiqueta>
        )}
        {aguardandoSeg !== null && aguardandoSeg >= LIMIAR_PENDENCIA_SEG && (
          <Etiqueta className={esperaEmAlarme ? COR_URGENCIA.media : undefined}>
            <Clock className="h-3 w-3" />
            {t('aguardando', { tempo: formatarDuracaoUtil(aguardandoSeg) })}
          </Etiqueta>
        )}
        {foraDaJanela && (
          <Etiqueta className={COR_URGENCIA.media} title={t('foraDaJanelaTitulo')}>
            {t('foraDaJanela', { dias: JANELA_DIAS })}
          </Etiqueta>
        )}
        {i.pedidos_abertos > 0 && (
          <Etiqueta>{t('pedidos', { count: i.pedidos_abertos })}</Etiqueta>
        )}
        {i.mencao_processo && (
          <Etiqueta>
            <Scale className="h-3 w-3" />
            {t('mencaoProcesso')}
          </Etiqueta>
        )}
        {detalhes?.sem_ia && <Etiqueta>{t('semIa')}</Etiqueta>}
        {detalhes?.sem_cliente_na_janela && (
          <Etiqueta title={t('semClienteTitulo')}>{t('semCliente')}</Etiqueta>
        )}
        {i.status === 'failed' && (
          <Etiqueta className={COR_URGENCIA.alta}>{t('analiseFalhou')}</Etiqueta>
        )}
        {i.estado !== 'aberto' && (
          <Etiqueta>{t(`estado_${i.estado}`)}</Etiqueta>
        )}
      </div>

      {i.resumo && (
        <p className="mt-2 text-sm text-muted-foreground">{i.resumo}</p>
      )}

      {expandida && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('metricasLinha', {
              primeira:
                i.primeira_resposta_seg === null
                  ? '—'
                  : formatarDuracaoUtil(i.primeira_resposta_seg),
              mediana:
                i.resposta_mediana_seg === null
                  ? '—'
                  : formatarDuracaoUtil(i.resposta_mediana_seg),
              mensagens: i.mensagens_analisadas,
            })}
            {i.mensagens_sem_texto > 0 && (
              <> · {t('audioAviso', { count: i.mensagens_sem_texto })}</>
            )}
            {detalhes?.janela_cortada && <> · {t('janelaCortada')}</>}
            {i.analisado_em && (
              <>
                {' · '}
                {t('analisadoEm', {
                  quando: new Date(i.analisado_em).toLocaleString(undefined, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </>
            )}
          </p>

          {analise?.urgenciaMotivo && (
            <Sinal titulo={t('urgenciaTitulo')} detalhe={analise.urgenciaMotivo} evidencias={analise.urgenciaEvidencias ?? []} />
          )}
          {analise?.insatisfacaoMotivo && (
            <Sinal titulo={t('insatisfacao')} detalhe={analise.insatisfacaoMotivo} evidencias={analise.insatisfacaoEvidencias ?? []} />
          )}
          {(analise?.pedidosNaoAtendidos ?? []).map((p, idx) => (
            <Sinal key={idx} titulo={t('pedidoTitulo')} detalhe={p.pedido} evidencias={p.evidencias} />
          ))}
          {(analise?.pontosDeAtencao ?? []).map((p, idx) => (
            <Sinal key={idx} titulo={p.titulo} detalhe={p.detalhe} evidencias={p.evidencias} />
          ))}
          {podeVerEquipe &&
            (analise?.observacoesPorAtendente ?? []).map((o, idx) => (
              <Sinal
                key={`atendente-${idx}`}
                titulo={t('atendenteTitulo', { nome: o.atendente })}
                detalhe={o.observacao}
                evidencias={o.evidencias}
              />
            ))}
          {processos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('processosTitulo')}{' '}
              <span className="font-mono text-foreground">{processos.join(' · ')}</span>
            </p>
          )}
          {i.status === 'failed' && i.erro && (
            <p className="text-xs text-destructive">{i.erro}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/inbox?c=${i.conversation_id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('verNoChat')}
        </Link>
        {podeAgir && i.estado === 'aberto' && (
          <>
            <button
              type="button"
              disabled={ocupada}
              onClick={() => aoMudarEstado('tratado')}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {t('tratar')}
            </button>
            <button
              type="button"
              disabled={ocupada}
              onClick={() => aoMudarEstado('descartado')}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              title={t('descartarTitulo')}
            >
              {t('descartar')}
            </button>
          </>
        )}
        {podeAgir && i.estado !== 'aberto' && (
          <button
            type="button"
            disabled={ocupada}
            onClick={() => aoMudarEstado('aberto')}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('reabrir')}
          </button>
        )}
        {podeAgir && (
          <button
            type="button"
            disabled={ocupada}
            onClick={aoReanalisar}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {ocupada ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t('reanalisar')}
          </button>
        )}
      </div>
    </li>
  );
}

/** Um sinal com sua evidência — o trecho REAL da mensagem que o justifica.
 *  Sem trecho, o sinal nem chegou aqui (o parser da rubrica descartou). */
function Sinal({
  titulo,
  detalhe,
  evidencias,
}: {
  titulo: string;
  detalhe: string;
  evidencias: Evidencia[];
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalhe}</p>
      {evidencias.map((e) => (
        <p key={e.indice} className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
          “{e.trecho}”
        </p>
      ))}
    </div>
  );
}
