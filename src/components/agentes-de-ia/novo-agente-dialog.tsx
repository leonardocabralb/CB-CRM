'use client';

// "Novo agente": em branco ou a partir de um modelo de partida (Triagem,
// Cobrança, Financeiro — 5.9 do plano). As instruções e as regras de partida
// moram no DICIONÁRIO, sem o nome do escritório (o `produto-gate`).
//
// O modelo sai da lista da CHAVE do provedor (25/10/2026,
// `provedor-e-modelo.tsx`): sem escolha da pessoa, o recomendado que a chave
// tem — DERIVADO no render, nunca gravado por efeito.
//
// DOIS PASSOS (10/11/2026, pedido do operador): 1) para que serve — cada
// modelo de partida diz o que já traz, com as regras à vista (a "Triagem"
// traz "não informar honorários", que barra o "Conduz o fechamento"); 2) nome
// e modelo — os RECOMENDADOS que a chave tem em cartões, a lista inteira em
// "Outro modelo". Embaixo, o caminho até o agente atender.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import { modeloRecomendado, opcoesDeModelo } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import {
  buscarChaves,
  MODELOS_DE_PARTIDA,
  NOME_DO_PROVEDOR,
  PROVEDORES,
  type ChavesDaConta,
  type ModeloDePartida,
} from './tipos';
import { textoDoCodigo } from './textos';
import { listaDaChave, QuemLeAMidia, SeletorDeModelo, useModelosDasChaves } from './provedor-e-modelo';

export function NovoAgenteDialog({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const t = useTranslations('IaAgentes');
  const router = useRouter();
  const [passo, setPasso] = useState<1 | 2>(1);
  const [nome, setNome] = useState('');
  const [partida, setPartida] = useState<ModeloDePartida>('triagem');
  const [provedor, setProvedor] = useState<AiProvider>('gemini');
  const [chaves, setChaves] = useState<ChavesDaConta>(null);
  const [salvando, setSalvando] = useState(false);
  // "Outro modelo": a lista inteira da chave, no lugar dos cartões.
  const [listaInteira, setListaInteira] = useState(false);
  // Só busca com o diálogo ABERTO (ele fica montado na lista de agentes).
  const modelosDasChaves = useModelosDasChaves(aberto);
  // A escolha da pessoa vale só para o provedor em que foi feita (carimbo):
  // trocar de provedor volta ao recomendado daquela chave.
  const [escolhido, setEscolhido] = useState<{ de: AiProvider; modelo: string } | null>(null);
  const listaDoProvedor = modelosDasChaves.leitura ? modelosDasChaves.leitura.provedores[provedor] : null;
  const daChave = listaDaChave(listaDoProvedor);
  const modelo =
    escolhido && escolhido.de === provedor ? escolhido.modelo : modeloRecomendado(provedor, daChave);
  // Os recomendados que a chave TEM (sem a lista, nenhum cartão: o seletor dá conta).
  const recomendados = daChave ? opcoesDeModelo(provedor, daChave).recomendados : [];

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void (async () => {
      const c = await buscarChaves();
      if (!vivo) return;
      setChaves(c);
      // Começa no primeiro provedor que TEM chave.
      const comChave = c ? PROVEDORES.find((p) => c[p]) : undefined;
      if (comChave) setProvedor(comChave);
    })();
    return () => {
      vivo = false;
    };
  }, [aberto]);

  /** As regras que o modelo de partida traz (uma por linha no dicionário). */
  function regrasDe(m: ModeloDePartida): string[] {
    if (m === 'em_branco') return [];
    return t(`modelos.${m}.regras`)
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }

  function fechar() {
    setPasso(1);
    setListaInteira(false);
    aoFechar();
  }

  async function criar() {
    setSalvando(true);
    try {
      const base =
        partida === 'em_branco'
          ? { descricao: '', instrucoes: '', regras: [] as string[] }
          : {
              descricao: t(`modelos.${partida}.descricao`),
              instrucoes: t(`modelos.${partida}.instrucoes`),
              regras: regrasDe(partida),
            };
      const res = await fetch('/api/cb/ia/agentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim() || (partida === 'em_branco' ? '' : t(`modelos.${partida}.nome`)),
          provedor,
          modelo: modelo.trim(),
          ...base,
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: { id: string }; code?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, (corpo as { error?: string }).error));
        return;
      }
      fechar();
      router.push(`/agents/${corpo.agente.id}`);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  const nomePadrao = partida === 'em_branco' ? '' : t(`modelos.${partida}.nome`);
  const regrasDaPartida = regrasDe(partida);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="min-w-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('novo.titulo')}</DialogTitle>
          <DialogDescription>{t('novo.descricao')}</DialogDescription>
        </DialogHeader>

        {/* Os dois passos, como trilha. */}
        <ol className="flex items-center gap-2 text-xs" aria-label={t('novo.passos')}>
          {([1, 2] as const).map((p) => (
            <li key={p} className="flex items-center gap-2">
              {p === 2 ? <span aria-hidden className="h-px w-6 bg-border" /> : null}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  passo === p ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
                aria-current={passo === p ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'inline-flex size-5 items-center justify-center rounded-full border text-[11px]',
                    passo === p
                      ? 'border-primary bg-primary text-primary-foreground'
                      : passo > p
                        ? 'border-primary/50 text-primary'
                        : 'border-border',
                  )}
                >
                  {passo > p ? <Check className="size-3" /> : p}
                </span>
                {p === 1 ? t('novo.passo1') : t('novo.passo2')}
              </span>
            </li>
          ))}
        </ol>

        {passo === 1 ? (
          <div className="min-w-0 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {MODELOS_DE_PARTIDA.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPartida(m)}
                  aria-pressed={partida === m}
                  className={cn(
                    'min-w-0 rounded-lg border p-3 text-left text-sm transition-colors',
                    partida === m ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <span className="block font-medium text-foreground">
                    {m === 'em_branco' ? t('novo.emBranco') : t(`modelos.${m}.nome`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {m === 'em_branco' ? t('novo.emBrancoDica') : t(`modelos.${m}.descricao`)}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    {m === 'em_branco' ? t('novo.trazNada') : t('novo.traz', { n: regrasDe(m).length })}
                  </span>
                </button>
              ))}
            </div>
            {regrasDaPartida.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                <p className="mb-1 font-medium text-foreground">{t('novo.regrasQueVem')}</p>
                <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                  {regrasDaPartida.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
                <p className="mt-1.5 text-muted-foreground">{t('novo.tudoMuda')}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="novo-agente-nome">{t('campo.nome')}</Label>
              <Input
                id="novo-agente-nome"
                value={nome}
                placeholder={nomePadrao || t('campo.nomeExemplo')}
                onChange={(e) => setNome(e.target.value)}
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground">{t('novo.nomeDica')}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t('campo.provedor')}</Label>
              <div className="flex flex-wrap gap-2">
                {PROVEDORES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvedor(p)}
                    aria-pressed={provedor === p}
                    // Sem chave o agente nasceria mudo: o servidor recusa
                    // (`provedor_sem_chave`) e a tela nem oferece.
                    disabled={chaves !== null && !chaves[p]}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50',
                      provedor === p ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'
                    )}
                  >
                    {NOME_DO_PROVEDOR[p]}
                    {chaves && !chaves[p] ? ` · ${t('campo.semChave')}` : ''}
                  </button>
                ))}
              </div>
              {chaves && !chaves[provedor] ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.provedorSemChave')}</p>
              ) : null}
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="novo-agente-modelo">{t('campo.modelo')}</Label>
              {recomendados.length > 0 && !listaInteira ? (
                <div className="space-y-1.5">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {recomendados.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={modelo === m.id}
                        onClick={() => setEscolhido({ de: provedor, modelo: m.id })}
                        className={cn(
                          'min-w-0 rounded-lg border p-2.5 text-left transition-colors',
                          modelo === m.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className="block truncate text-sm font-medium text-foreground" title={m.nome}>
                          {m.nome}
                        </span>
                        <code className="block truncate text-[11px] text-muted-foreground">{m.id}</code>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setListaInteira(true)}
                  >
                    {t('novo.outroModelo')}
                  </button>
                </div>
              ) : (
                <SeletorDeModelo
                  id="novo-agente-modelo"
                  provedor={provedor}
                  valor={modelo}
                  aoMudar={(m) => setEscolhido({ de: provedor, modelo: m })}
                  lista={listaDoProvedor}
                  atualizando={modelosDasChaves.atualizando}
                  aoAtualizar={modelosDasChaves.atualizar}
                />
              )}
              {/* A linha curta de quem lê a mídia (o quadro inteiro está na Configuração). */}
              <QuemLeAMidia leitores={modelosDasChaves.leitura ? modelosDasChaves.leitura.leitores : undefined} compacto />
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{t('novo.depois')}</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>{t('novo.depois1')}</li>
                <li>{t('novo.depois2')}</li>
                <li>{t('novo.depois3')}</li>
                <li>{t('novo.depois4')}</li>
              </ol>
            </div>
          </div>
        )}

        <DialogFooter>
          {passo === 1 ? (
            <>
              <Button variant="outline" onClick={fechar}>
                {t('cancelar')}
              </Button>
              <Button onClick={() => setPasso(2)}>{t('novo.continuar')}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPasso(1)} disabled={salvando}>
                {t('novo.voltar')}
              </Button>
              <Button
                onClick={() => void criar()}
                disabled={
                  salvando || (!nome.trim() && !nomePadrao) || !modelo.trim() || (chaves !== null && !chaves[provedor])
                }
              >
                {t('novo.criar')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
