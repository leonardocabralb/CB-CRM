'use client';

// ============================================================
// Aba "Automações" do painel da conversa — o que está RODANDO para o
// cliente, com o botão de parar (pedido do operador em 2026-08-30, na
// referência do Kommo: cancelar um follow-up sem esperar ele terminar).
//
// Os dados chegam por props (hook `useExecucoesDoContato`, chamado no TOPO
// do painel como as outras buscas — trocar de aba não refaz query, e a
// etiqueta da aba precisa do número antes de a aba abrir).
//
// Parar é DESTRUTIVO para o fluxo do cliente (as mensagens futuras deixam
// de sair), então cada linha confirma em dois cliques, no lugar — sem
// dialog: o contexto todo já está na linha.
// ============================================================

import { useState } from 'react';
import { Bot, Loader2, RefreshCw, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import type { RoboAtivo } from '@/hooks/use-execucoes-do-contato';
import type { EsperaAgrupada } from '@/lib/execucoes/agrupar';
import { relativoAoInstante } from '@/lib/execucoes/tempo';
import { TituloDeSecao } from './painel-do-contato';

interface AbaAutomacoesProps {
  contactId: string;
  robos: RoboAtivo[];
  esperas: EsperaAgrupada[];
  carregou: boolean;
  erro: boolean;
  recarregar: () => void;
}

export function AbaAutomacoes({
  contactId,
  robos,
  esperas,
  carregou,
  erro,
  recarregar,
}: AbaAutomacoesProps) {
  const t = useTranslations('Inbox.execucoes');
  const podeAgir = useCan('send-messages');

  /** Chave da linha aguardando o segundo clique ('robo' | automationId). */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  /** Chave da linha com POST no ar — trava o botão clicado. */
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function parar(chave: string, corpo: Record<string, string>, rota: string) {
    setOcupado(chave);
    try {
      const res = await fetch(rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const data = (await res.json().catch(() => ({}))) as {
        paradas?: number;
        canceladas?: number;
      };
      if (!res.ok) {
        toast.error(t('erroParar'));
        return;
      }
      // 0 não é falha: a lista é uma foto de segundos atrás e a espera pode
      // ter acordado (ou o robô terminado) entre a carga e o clique.
      const efetivadas = data.paradas ?? data.canceladas ?? 0;
      if (efetivadas === 0) {
        toast.info(t('nadaParaParar'));
      } else {
        toast.success(chave === 'robo' ? t('roboParado') : t('automacaoParada'));
      }
      recarregar();
    } catch {
      toast.error(t('erroParar'));
    } finally {
      setOcupado(null);
      setConfirmando(null);
    }
  }

  function BotaoParar({ chave, onParar }: { chave: string; onParar: () => void }) {
    if (ocupado === chave) {
      return (
        <Button size="sm" variant="ghost" disabled className="h-7 shrink-0 px-2">
          <Loader2 className="size-3.5 animate-spin" />
        </Button>
      );
    }
    if (confirmando === chave) {
      return (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={onParar}
          >
            {t('confirmarParar')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground h-7 px-2 text-xs"
            onClick={() => setConfirmando(null)}
          >
            {t('cancelar')}
          </Button>
        </span>
      );
    }
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={!podeAgir}
        title={podeAgir ? undefined : t('somenteLeitura')}
        className="text-destructive hover:text-destructive h-7 shrink-0 px-2 text-xs"
        onClick={() => setConfirmando(chave)}
      >
        {t('parar')}
      </Button>
    );
  }

  if (!carregou) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Falha de carga NUNCA vira "nada em execução": afirmar ausência com a
  // consulta quebrada é o modo de falha que este projeto mais persegue.
  if (erro) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground text-sm">{t('erroCarregar')}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={recarregar}>
          <RefreshCw className="size-3.5" />
          {t('tentarDeNovo')}
        </Button>
      </div>
    );
  }

  if (robos.length === 0 && esperas.length === 0) {
    return (
      <div className="py-8 text-center">
        <Zap className="text-muted-foreground/40 mx-auto h-8 w-8" />
        <p className="text-muted-foreground mt-2 text-sm">{t('nadaRodando')}</p>
        <p className="text-muted-foreground/70 mt-1 text-xs">{t('dica')}</p>
      </div>
    );
  }

  const agora = Date.now();

  return (
    <div className="space-y-4">
      {robos.length > 0 && (
        <div>
          <TituloDeSecao icon={<Bot className="h-3 w-3" />}>
            {t('roboAtivo')}
          </TituloDeSecao>
          <div className="space-y-2">
            {robos.map((robo) => (
              <div
                key={robo.runId}
                className="border-border bg-muted/40 flex items-center gap-2 rounded-md border p-2.5"
              >
                <Bot className="text-primary h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {robo.nome ?? t('semNome')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('iniciado', {
                      quando: relativoAoInstante(robo.iniciadoEm, agora),
                    })}
                  </p>
                </div>
                {/* Um "Parar" por linha, mas a rota encerra TODA run ativa do
                    contato — é o grão do motor (stop_flow), e >1 ativa só
                    acontece em corrida. */}
                <BotaoParar
                  chave="robo"
                  onParar={() =>
                    void parar(
                      'robo',
                      { contact_id: contactId },
                      '/api/cb/execucoes/parar-robo',
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {esperas.length > 0 && (
        <div>
          <TituloDeSecao icon={<Zap className="h-3 w-3" />}>
            {t('aguardando')}
          </TituloDeSecao>
          <div className="space-y-2">
            {esperas.map((grupo) => (
              <div
                key={grupo.automationId}
                className="border-border bg-muted/40 flex items-center gap-2 rounded-md border p-2.5"
              >
                <Zap className="text-primary h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {grupo.nome ?? t('semNome')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('proximoPasso', {
                      quando: relativoAoInstante(grupo.proximaEm, agora),
                    })}
                    {grupo.esperas > 1
                      ? ` · ${t('passos', { n: grupo.esperas })}`
                      : ''}
                  </p>
                </div>
                <BotaoParar
                  chave={grupo.automationId}
                  onParar={() =>
                    void parar(
                      grupo.automationId,
                      {
                        contact_id: contactId,
                        automation_id: grupo.automationId,
                      },
                      '/api/cb/execucoes/parar-automacao',
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
