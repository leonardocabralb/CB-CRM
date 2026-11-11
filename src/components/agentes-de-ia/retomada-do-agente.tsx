'use client';

// ============================================================
// Sub-aba Retomada de um agente de IA (1056, pedido do operador em
// 27/09/2026): quando o agente pergunta algo e o cliente não responde, ele
// volta a falar numa cadência (padrão 15 min · 1 h · 3 h · 6 h · 12 h · 48 h,
// contados da última mensagem do agente sem resposta), só dentro de uma
// janela do dia. Salva pelo PATCH do agente, mandando SÓ `retomada` (o objeto
// inteiro — o servidor recusa cadência ou janela fora da forma com
// `retomada_invalida`).
//
// ⚠️ A tela diz QUANDO a série para (o cliente respondeu, a equipe assumiu, o
// card saiu da etapa, perto dos lembretes da reunião): é o que o operador
// precisa saber antes de ligar.
//
// 10/11/2026 (o operador não entendia quantas tentativas e de quanto em
// quanto tempo): a cadência é uma LISTA numerada ("Tentativa 2 · 1 h depois
// da resposta do agente"), com a linha do tempo em cima e "Nova tentativa"
// embaixo; quando para vira chips, com o texto inteiro ao abrir. O Salvar é o
// da barra do detalhe (`registrarSalvar`).
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CADENCIA_PADRAO, cadenciaValida, LIMITES_DA_RETOMADA } from '@/lib/ia-agentes/retomada';
import { cn } from '@/lib/utils';
import { acrescentarIntervalo, retomadaMudou, type RascunhoDaAba } from './rascunho';
import { PARADAS_A_VISTA, textoDoCodigo, textoDoIntervalo } from './textos';
import type { ConfigDaRetomada, IaAgente, SalvarDaAba } from './tipos';

const UNIDADES = ['min', 'h', 'd'] as const;
type Unidade = (typeof UNIDADES)[number];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function copiar(r: ConfigDaRetomada): ConfigDaRetomada {
  return { ativa: r.ativa, cadencia: [...r.cadencia], janela: { ...r.janela } };
}

export function RetomadaDoAgente({
  agente,
  aoSalvar,
  aoMudarNaoSalvo,
  aoMudarRascunho,
  registrarSalvar,
}: {
  agente: IaAgente;
  aoSalvar: (novo: IaAgente) => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
  /** Avisa o detalhe do que o Salvar mandaria agora: é o RASCUNHO que o Playground testa (DC4). */
  aoMudarRascunho?: (rascunho: RascunhoDaAba | null) => void;
  /** Entrega ao detalhe o Salvar desta aba (a barra de salvar o chama). */
  registrarSalvar?: (salvar: SalvarDaAba | null) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [rascunho, setRascunho] = useState<ConfigDaRetomada>(() => copiar(agente.retomada));
  const [valor, setValor] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('h');

  const naoSalvo = retomadaMudou(agente.retomada, rascunho);
  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  // O rascunho do Playground (DC4): o MESMO corpo do Salvar (cadência ou
  // janela fora da forma = o mesmo 400 do Salvar), carimbado com a versão do agente.
  const rascunhoDoTeste = useMemo(
    () => (naoSalvo ? { de: agente.updatedAt, corpo: { retomada: rascunho } } : null),
    [naoSalvo, rascunho, agente.updatedAt]
  );
  useEffect(() => {
    aoMudarRascunho?.(rascunhoDoTeste);
  }, [rascunhoDoTeste, aoMudarRascunho]);

  const janelaValida =
    HORA.test(rascunho.janela.inicio) && HORA.test(rascunho.janela.fim) && rascunho.janela.inicio < rascunho.janela.fim;
  const ehPadrao =
    rascunho.cadencia.length === CADENCIA_PADRAO.length && rascunho.cadencia.every((m, i) => m === CADENCIA_PADRAO[i]);

  function acrescentar() {
    const r = acrescentarIntervalo(rascunho.cadencia, valor, unidade);
    if (!r.ok) {
      toast.error(
        r.motivo === 'cheia'
          ? t('retomada.cheia', { max: LIMITES_DA_RETOMADA.tentativasMax })
          : r.motivo === 'repetido'
            ? t('retomada.repetido')
            : t('retomada.invalido')
      );
      return;
    }
    setRascunho((x) => ({ ...x, cadencia: r.cadencia }));
    setValor('');
  }

  /** O Salvar desta aba (a barra do detalhe o chama): `true` = gravou ou não havia o que gravar. */
  async function salvar(): Promise<boolean> {
    if (!naoSalvo) return true;
    if (!janelaValida) {
      toast.error(t('retomada.janelaInvalida'));
      return false;
    }
    if (!cadenciaValida(rascunho.cadencia)) {
      toast.error(t('retomada.invalido'));
      return false;
    }
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retomada: rascunho }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string; error?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        return false;
      }
      toast.success(t('retomada.salvo'));
      setRascunho(copiar(corpo.agente.retomada));
      aoSalvar(corpo.agente);
      return true;
    } catch {
      toast.error(t('erro.generico'));
      return false;
    }
  }
  // A barra de salvar do detalhe chama o Salvar MAIS RECENTE (o do último render).
  useEffect(() => {
    registrarSalvar?.(salvar);
  });
  useEffect(() => () => registrarSalvar?.(null), [registrarSalvar]);

  const ultima = rascunho.cadencia.at(-1);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('retomada.explicacao')}</p>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('retomada.ligar')}</p>
          <p className="text-xs text-muted-foreground">{t('retomada.ligarDica')}</p>
        </div>
        <Switch
          checked={rascunho.ativa}
          onCheckedChange={(v) => setRascunho((x) => ({ ...x, ativa: v === true }))}
          aria-label={t('retomada.ligar')}
        />
      </div>

      <section className={cn('space-y-3 rounded-lg border border-border p-4', !rascunho.ativa && 'opacity-70')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">
              {t('retomada.tentativas', { n: rascunho.cadencia.length, max: LIMITES_DA_RETOMADA.tentativasMax })}
            </h3>
            <p className="text-xs text-muted-foreground">{t('retomada.tentativasDica')}</p>
          </div>
          {!ehPadrao ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setRascunho((x) => ({ ...x, cadencia: [...CADENCIA_PADRAO] }))}
            >
              <RotateCcw className="size-3.5" /> {t('retomada.restaurarPadrao')}
            </Button>
          ) : null}
        </div>

        {/* A linha do tempo: a resposta do agente e, depois dela, cada tentativa. */}
        <div className="flex flex-wrap items-center gap-y-2 text-xs" aria-hidden>
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
            {t('retomada.linhaInicio')}
          </span>
          {rascunho.cadencia.map((minutos) => (
            <span key={minutos} className="flex items-center">
              <span className="mx-1 h-px w-4 bg-border sm:w-6" />
              <span className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-foreground">
                +{textoDoIntervalo(t, minutos)}
              </span>
            </span>
          ))}
        </div>

        <ol className="divide-y divide-border rounded-md border border-border" aria-label={t('retomada.cadencia')}>
          {rascunho.cadencia.map((minutos, i) => (
            <li key={minutos} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{t('retomada.tentativa', { n: i + 1 })}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {t('retomada.depoisDaResposta', { tempo: textoDoIntervalo(t, minutos) })}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                aria-label={t('retomada.remover', { tempo: textoDoIntervalo(t, minutos) })}
                // A cadência tem pelo menos UMA tentativa (para desligar, a chave).
                disabled={rascunho.cadencia.length <= LIMITES_DA_RETOMADA.tentativasMin}
                onClick={() => setRascunho((x) => ({ ...x, cadencia: x.cadencia.filter((m) => m !== minutos) }))}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ol>

        {rascunho.cadencia.length < LIMITES_DA_RETOMADA.tentativasMax ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="retomada-valor" className="text-sm text-foreground">
              {t('retomada.novaTentativa')}
            </Label>
            <Input
              id="retomada-valor"
              inputMode="numeric"
              className="w-20"
              value={valor}
              placeholder={t('retomada.novoIntervalo')}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  acrescentar();
                }
              }}
            />
            <div className="flex gap-1" role="group" aria-label={t('retomada.unidadeDoIntervalo')}>
              {UNIDADES.map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={unidade === u}
                  onClick={() => setUnidade(u)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    unidade === u ? 'border-primary bg-primary/5' : 'border-border text-muted-foreground'
                  )}
                >
                  {t(`retomada.unidadeNome.${u}`)}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{t('retomada.depoisDaRespostaCurto')}</span>
            <Button variant="outline" size="sm" onClick={acrescentar} disabled={!valor.trim()}>
              <Plus className="size-3.5" /> {t('retomada.adicionar')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('retomada.cheia', { max: LIMITES_DA_RETOMADA.tentativasMax })}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('retomada.limitesDaCadencia')}
          {ultima !== undefined ? ` ${t('retomada.ultimaEm', { tempo: textoDoIntervalo(t, ultima) })}` : ''}
        </p>
      </section>

      <section className={cn('space-y-3 rounded-lg border border-border p-4', !rascunho.ativa && 'opacity-70')}>
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">{t('retomada.janela')}</h3>
          <p className="text-xs text-muted-foreground">{t('retomada.janelaDica')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input
            type="time"
            className="w-32"
            aria-label={t('retomada.inicio')}
            value={rascunho.janela.inicio}
            onChange={(e) => setRascunho((x) => ({ ...x, janela: { ...x.janela, inicio: e.target.value } }))}
          />
          <span className="text-muted-foreground">{t('campo.ate')}</span>
          <Input
            type="time"
            className="w-32"
            aria-label={t('retomada.fim')}
            value={rascunho.janela.fim}
            onChange={(e) => setRascunho((x) => ({ ...x, janela: { ...x.janela, fim: e.target.value } }))}
          />
        </div>
        {!janelaValida ? <p className="text-xs text-red-700 dark:text-red-300">{t('retomada.janelaInvalida')}</p> : null}
        {agente.horario ? (
          <p className="text-xs text-muted-foreground">
            {t('retomada.janelaComHorario', { inicio: agente.horario.inicio, fim: agente.horario.fim })}
          </p>
        ) : null}
      </section>

      {/* Quando a série para sozinha: o resumo à vista, o texto inteiro ao abrir. */}
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{t('retomada.paraQuando')}</h3>
        <ul className="flex flex-wrap gap-1.5">
          {PARADAS_A_VISTA.map((p) => (
            <li key={p} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
              {t(`retomada.para.${p}`)}
            </li>
          ))}
        </ul>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">{t('retomada.paradasDetalhe')}</summary>
          <p className="mt-1.5">{t('retomada.paradas')}</p>
        </details>
      </section>
    </div>
  );
}
