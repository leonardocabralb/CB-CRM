'use client';

// ============================================================
// A janela "Por que…?" (Fase 2 do docs/PLANO-motivos-de-perda.md).
//
// Quem leva o card a uma etapa que pede motivo (`campo_do_motivo_id`, 1112)
// escolhe o motivo ANTES de o card se mover: a janela grava o campo Lista na
// ficha e só então chama `mover`. Decisões do operador (26/10/2026):
// - OBRIGATÓRIO para pessoas: sem motivo o card não vai; cancelar não grava
//   nada e o card fica onde estava;
// - 3 ou 4 motivos + "Outro", que abre texto livre gravado no PRÓPRIO campo;
// - o botão "Perdido" passa a escolher a ETAPA de perda e o motivo dela, e
//   move (várias `etapas` no pedido).
//
// ⚠️ Só os caminhos de GENTE usam a janela. Automação, robô, IA e API nunca a
// abrem (não há quem responda): a automação grava o motivo no próprio passo
// (Fase 3).
//
// ⚠️ Configuração quebrada não trava o trabalho: campo que deixou de ser
// Lista, sumiu ou ficou sem opção deixa mover SEM motivo, com aviso. Leitura
// que falhou, não: "Tentar de novo" ou cancelar (o movimento provavelmente
// falharia também).
//
// ⚠️ Card sem contato (ficha na Lixeira): não há ficha onde gravar — move sem
// janela, com aviso.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { salvarValoresDoContato } from '@/lib/contacts/custom-values';
import {
  escolhaInicial,
  opcoesDaJanela,
  serveParaMotivo,
  valorDaEscolha,
  type EscolhaDeMotivo,
} from '@/lib/pipelines/motivo-da-etapa';
import { createClient } from '@/lib/supabase/client';
import type { CustomField, PipelineStage } from '@/types';

export type EtapaDoMotivo = Pick<PipelineStage, 'id' | 'name' | 'color' | 'campo_do_motivo_id'>;

export interface PedidoDeMotivo {
  /** Uma etapa (o destino escolhido) ou as de perda do funil (botão "Perdido"). */
  etapas: EtapaDoMotivo[];
  /** O cliente do card; `null` quando a ficha está na Lixeira. */
  contato: { id: string; nome: string } | null;
  /** Move o card. Quem move avisa o sucesso e a falha do movimento. */
  mover: (etapaId: string) => unknown;
  /** O motivo gravado, para a tela que mostra a ficha espelhar. */
  aoGravarMotivo?: (campoId: string, valor: string) => void;
}

/**
 * A janela e quem a abre. `pedirMotivo` devolve `true` quando a janela abriu
 * (o movimento espera a escolha) e `false` quando moveu direto — a etapa não
 * pede motivo, ou o card não tem ficha.
 */
export function useJanelaDoMotivo(): {
  pedirMotivo: (pedido: PedidoDeMotivo) => boolean;
  janela: ReactNode;
} {
  const t = useTranslations('Pipelines.janelaDoMotivo');
  // `numero` remonta a janela a cada pedido: o rascunho (etapa, escolha,
  // texto) nasce de novo, nunca o da janela anterior.
  const [aberto, setAberto] = useState<{ pedido: PedidoDeMotivo; numero: number } | null>(null);

  const pedirMotivo = useCallback(
    (novo: PedidoDeMotivo) => {
      const unica = novo.etapas.length === 1 ? novo.etapas[0] : null;
      if (unica && !unica.campo_do_motivo_id) {
        void novo.mover(unica.id);
        return false;
      }
      if (unica && !novo.contato) {
        toast.info(t('semContato'));
        void novo.mover(unica.id);
        return false;
      }
      if (novo.etapas.length === 0) return false;
      setAberto((anterior) => ({ pedido: novo, numero: (anterior?.numero ?? 0) + 1 }));
      return true;
    },
    [t],
  );

  const janela = aberto ? (
    <JanelaDoMotivo key={aberto.numero} pedido={aberto.pedido} aoFechar={() => setAberto(null)} />
  ) : null;

  return { pedirMotivo, janela };
}

type Leitura =
  | { estado: 'sem_campo' }
  | { estado: 'carregando'; campoId: string }
  | { estado: 'falhou'; campoId: string }
  | { estado: 'indisponivel'; campoId: string }
  | { estado: 'pronto'; campoId: string; campo: CustomField; valorAtual: string | null };

function JanelaDoMotivo({ pedido, aoFechar }: { pedido: PedidoDeMotivo; aoFechar: () => void }) {
  const t = useTranslations('Pipelines.janelaDoMotivo');
  const variasEtapas = pedido.etapas.length > 1;
  const [etapaId, setEtapaId] = useState<string | null>(variasEtapas ? null : pedido.etapas[0].id);
  const etapa = pedido.etapas.find((e) => e.id === etapaId) ?? null;
  const campoId = pedido.contato ? (etapa?.campo_do_motivo_id ?? null) : null;

  // A leitura é carimbada com o campo que a pediu: trocar de etapa no meio
  // descarta a resposta da anterior (`{ de, … }`, CLAUDE.md 8c).
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [escolha, setEscolha] = useState<{ de: string; valor: EscolhaDeMotivo } | null>(null);
  const [gravando, setGravando] = useState(false);

  const contatoId = pedido.contato?.id ?? null;
  useEffect(() => {
    if (!campoId || !contatoId) return;
    let vivo = true;
    const supabase = createClient();
    void Promise.all([
      supabase
        .from('custom_fields')
        .select('id, user_id, account_id, field_name, field_type, field_key, field_options, created_at')
        .eq('id', campoId)
        .maybeSingle(),
      supabase
        .from('contact_custom_values')
        .select('value')
        .eq('contact_id', contatoId)
        .eq('custom_field_id', campoId)
        .maybeSingle(),
    ]).then(([campoRes, valorRes]) => {
      if (!vivo) return;
      if (campoRes.error || valorRes.error) {
        setLeitura({ estado: 'falhou', campoId });
        return;
      }
      const campo = campoRes.data as CustomField | null;
      if (!campo || !serveParaMotivo(campo)) {
        setLeitura({ estado: 'indisponivel', campoId });
        return;
      }
      const valorAtual = (valorRes.data as { value: string | null } | null)?.value ?? null;
      setLeitura({ estado: 'pronto', campoId, campo, valorAtual });
      setEscolha({ de: campoId, valor: escolhaInicial(campo, valorAtual) });
    });
    return () => {
      vivo = false;
    };
  }, [campoId, contatoId, tentativa]);

  // Derivado no render: a leitura de OUTRO campo (etapa anterior) é
  // "carregando" para esta.
  const atual: Leitura | null = !etapa
    ? null
    : !campoId
      ? { estado: 'sem_campo' }
      : leitura && leitura.estado !== 'sem_campo' && leitura.campoId === campoId
        ? leitura
        : { estado: 'carregando', campoId };
  const escolhaAtual: EscolhaDeMotivo =
    escolha && campoId && escolha.de === campoId ? escolha.valor : { tipo: 'nenhuma' };
  const valor = atual?.estado === 'pronto' ? valorDaEscolha(escolhaAtual) : null;

  const podeMover =
    !!etapa &&
    !gravando &&
    (atual?.estado === 'sem_campo' || atual?.estado === 'indisponivel' || (atual?.estado === 'pronto' && valor !== null));

  async function confirmar() {
    if (!etapa || !podeMover) return;
    if (atual?.estado === 'pronto' && valor !== null && pedido.contato) {
      setGravando(true);
      const erro = await salvarValoresDoContato(createClient(), pedido.contato.id, {
        [atual.campo.id]: valor,
      });
      setGravando(false);
      if (erro) {
        toast.error(t('erroAoGravar', { campo: atual.campo.field_name, cliente: pedido.contato.nome }));
        return;
      }
      pedido.aoGravarMotivo?.(atual.campo.id, valor);
    }
    aoFechar();
    void pedido.mover(etapa.id);
  }

  const marcar = (valorNovo: EscolhaDeMotivo) => {
    if (campoId) setEscolha({ de: campoId, valor: valorNovo });
  };

  return (
    <Dialog
      open
      onOpenChange={(aberta) => {
        if (!aberta && !gravando) aoFechar();
      }}
    >
      <DialogContent className="bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {variasEtapas
              ? t('tituloPerdido')
              : t('titulo', { etapa: pedido.etapas[0].name })}
          </DialogTitle>
          {pedido.contato && (
            <DialogDescription className="min-w-0">
              {t('descricao', { cliente: pedido.contato.nome })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid min-w-0 gap-4">
          {variasEtapas && (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium text-foreground">{t('qualEtapa')}</p>
              <RadioGroup
                value={etapaId}
                onValueChange={(v) => typeof v === 'string' && setEtapaId(v)}
                aria-label={t('qualEtapa')}
                className="gap-1.5"
              >
                {pedido.etapas.map((e) => (
                  <label key={e.id} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-foreground">
                    <RadioGroupItem value={e.id} />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="truncate">{e.name}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {etapa && atual?.estado === 'carregando' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('carregando')}
            </p>
          )}

          {etapa && atual?.estado === 'falhou' && (
            <div className="flex items-center justify-between gap-2 text-sm text-red-700 dark:text-red-300">
              <span>{t('falhou')}</span>
              <Button variant="outline" size="sm" onClick={() => setTentativa((n) => n + 1)}>
                {t('tentarDeNovo')}
              </Button>
            </div>
          )}

          {etapa && atual?.estado === 'indisponivel' && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('campoIndisponivel')}</p>
          )}

          {etapa && variasEtapas && atual?.estado === 'sem_campo' && (
            <p className="text-sm text-muted-foreground">
              {pedido.contato ? t('etapaSemMotivo') : t('semContatoNaJanela')}
            </p>
          )}

          {atual?.estado === 'pronto' && (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium text-foreground">{atual.campo.field_name}</p>
              {/* O valor do item "Outro" é o próprio rótulo: as opções fixas
                  nunca o contêm (`opcoesDaJanela` o separa por `ehOutro`). */}
              <RadioGroup
                value={
                  escolhaAtual.tipo === 'fixa'
                    ? escolhaAtual.opcao
                    : escolhaAtual.tipo === 'outro'
                      ? opcoesDaJanela(atual.campo).outro
                      : null
                }
                onValueChange={(v) => {
                  if (typeof v !== 'string') return;
                  if (v === opcoesDaJanela(atual.campo).outro) {
                    marcar({ tipo: 'outro', texto: escolhaAtual.tipo === 'outro' ? escolhaAtual.texto : '' });
                  } else {
                    marcar({ tipo: 'fixa', opcao: v });
                  }
                }}
                aria-label={atual.campo.field_name}
                className="gap-1.5"
              >
                {opcoesDaJanela(atual.campo).fixas.map((opcao) => (
                  <label key={opcao} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-foreground">
                    <RadioGroupItem value={opcao} />
                    <span className="min-w-0 break-words">{opcao}</span>
                  </label>
                ))}
                {opcoesDaJanela(atual.campo).outro !== null && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <RadioGroupItem value={opcoesDaJanela(atual.campo).outro ?? ''} />
                    {opcoesDaJanela(atual.campo).outro}
                  </label>
                )}
              </RadioGroup>
              {escolhaAtual.tipo === 'outro' && (
                <Input
                  autoFocus
                  value={escolhaAtual.texto}
                  onChange={(e) => marcar({ tipo: 'outro', texto: e.target.value })}
                  placeholder={t('outroPlaceholder')}
                  aria-label={t('outroPlaceholder')}
                  className="ml-6 w-auto border-border bg-muted text-sm text-foreground"
                />
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button
            variant="outline"
            disabled={gravando}
            onClick={aoFechar}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {t('cancelar')}
          </Button>
          <Button
            onClick={() => void confirmar()}
            disabled={!podeMover}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {gravando ? t('gravando') : etapa ? t('mover', { etapa: etapa.name }) : t('escolhaAEtapa')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
