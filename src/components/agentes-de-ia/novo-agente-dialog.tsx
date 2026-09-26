'use client';

// "Novo agente": em branco ou a partir de um modelo de partida (Triagem,
// Cobrança, Financeiro — 5.9 do plano). As instruções e as regras de partida
// moram no DICIONÁRIO, sem o nome do escritório (o `produto-gate`).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Label } from '@/components/ui/label';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
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

export function NovoAgenteDialog({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const t = useTranslations('IaAgentes');
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [partida, setPartida] = useState<ModeloDePartida>('triagem');
  const [provedor, setProvedor] = useState<AiProvider>('gemini');
  const [chaves, setChaves] = useState<ChavesDaConta>(null);
  const [salvando, setSalvando] = useState(false);

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

  async function criar() {
    setSalvando(true);
    try {
      const base =
        partida === 'em_branco'
          ? { descricao: '', instrucoes: '', regras: [] as string[] }
          : {
              descricao: t(`modelos.${partida}.descricao`),
              instrucoes: t(`modelos.${partida}.instrucoes`),
              // Uma regra por linha no dicionário (ele não guarda lista).
              regras: t(`modelos.${partida}.regras`)
                .split('\n')
                .map((r) => r.trim())
                .filter((r) => r.length > 0),
            };
      const res = await fetch('/api/cb/ia/agentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim() || (partida === 'em_branco' ? '' : t(`modelos.${partida}.nome`)),
          provedor,
          modelo: AI_PROVIDER_DEFAULT_MODEL[provedor],
          ...base,
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: { id: string }; code?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, (corpo as { error?: string }).error));
        return;
      }
      aoFechar();
      router.push(`/agents/${corpo.agente.id}`);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  const nomePadrao = partida === 'em_branco' ? '' : t(`modelos.${partida}.nome`);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('novo.titulo')}</DialogTitle>
          <DialogDescription>{t('novo.descricao')}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label>{t('novo.partida')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODELOS_DE_PARTIDA.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPartida(m)}
                  aria-pressed={partida === m}
                  className={cn(
                    'min-w-0 rounded-md border p-2 text-left text-sm',
                    partida === m ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <span className="block font-medium text-foreground">
                    {m === 'em_branco' ? t('novo.emBranco') : t(`modelos.${m}.nome`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {m === 'em_branco' ? t('novo.emBrancoDica') : t(`modelos.${m}.descricao`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="novo-agente-nome">{t('campo.nome')}</Label>
            <Input
              id="novo-agente-nome"
              value={nome}
              placeholder={nomePadrao || t('campo.nomeExemplo')}
              onChange={(e) => setNome(e.target.value)}
              maxLength={80}
            />
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvando}>
            {t('cancelar')}
          </Button>
          <Button
            onClick={() => void criar()}
            disabled={salvando || (!nome.trim() && !nomePadrao) || (chaves !== null && !chaves[provedor])}
          >
            {t('novo.criar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
