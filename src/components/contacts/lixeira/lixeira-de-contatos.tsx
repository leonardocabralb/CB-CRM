'use client';

// ============================================================
// A tela da Lixeira de contatos (1097) — `/contacts/lixeira`.
//
// Decisões do operador (22/10/2026, docs/PLANO-lixeira-de-contatos.md): só
// admin; 90 dias e sai de vez (com os arquivos); restaurar volta com o MESMO
// id; identidade já usada por outra ficha BLOQUEIA a volta (B2); "Excluir
// agora" com confirmação forte e a marca de pedido de exclusão (B3).
//
// ⚠️ Carregando ≠ vazia ≠ falhou (seção 8c): "A Lixeira está vazia" só com
// resposta do banco. A recarga depois de uma ação mantém a lista na tela; se
// falhar, a lista fica com o aviso de que pode estar velha.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronLeft, Loader2, Search, Trash } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  restaurar,
  useArquivosParados,
  useItensDaLixeira,
  LIMITE_DA_LISTA,
} from '@/hooks/use-lixeira';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { type ItemDaLixeira } from '@/lib/contacts/lixeira';

import { avisarVolta } from './avisar-volta';
import { ExcluirDeVezDialog } from './excluir-de-vez-dialog';
import { ItemDaLixeiraLinha, contatoDoItem } from './item-da-lixeira';

export function LixeiraDeContatos() {
  const t = useTranslations('Contacts.lixeira');
  // A Lixeira é da CONTA: trocar de conta sem recarregar (o perfil muda no
  // lugar) remonta o conteúdo, senão ficava a lista da anterior.
  const { profileLoading, accountId } = useAuth();
  const pode = useCan('delete-contacts');

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('tela.voltar')}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Trash className="size-6 shrink-0 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t('tela.titulo')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('tela.descricao')}</p>
      </div>

      {profileLoading ? (
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : pode ? (
        <ConteudoDaLixeira key={accountId ?? 'sem-conta'} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('tela.somenteAdmin')}</p>
      )}
    </div>
  );
}

function ConteudoDaLixeira() {
  const t = useTranslations('Contacts.lixeira');
  const router = useRouter();
  const [busca, setBusca] = useState('');
  // A busca vai ao banco depois de uma pausa na digitação, não a cada tecla.
  const [buscaEnviada, setBuscaEnviada] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setBuscaEnviada(busca), 300);
    return () => clearTimeout(id);
  }, [busca]);

  const lista = useItensDaLixeira(buscaEnviada);
  const arquivos = useArquivosParados();

  // Relógio por tique: os dias restantes andam com a tela aberta (o React
  // Compiler recusa `Date.now()` no render).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** O item, ou o lote, com uma ação em voo — os botões esperam. */
  const [emAcao, setEmAcao] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<ItemDaLixeira | null>(null);

  const itens = lista.itens ?? [];
  const nomeDoItem = (itemId: string) => {
    const item = itens.find((i) => i.id === itemId);
    return item ? nomeDoContato(contatoDoItem(item), t('semNome')) : null;
  };
  const abrirFicha = (contactId: string) => router.push(`/contacts?contact=${contactId}`);

  async function restaurarItem(item: ItemDaLixeira) {
    setEmAcao(item.id);
    const r = await restaurar({ itens: [item.id] });
    setEmAcao(null);
    avisarVolta(t, r, { nomeDoItem, abrirFicha });
    lista.recarregar();
  }

  async function restaurarLote(item: ItemDaLixeira) {
    setEmAcao(item.loteId);
    const r = await restaurar({ lote: item.loteId });
    setEmAcao(null);
    avisarVolta(t, r, { nomeDoItem, abrirFicha });
    lista.recarregar();
  }

  return (
    <div className="min-w-0 space-y-4">
      {arquivos !== null && arquivos.parados > 0 && (
        <div className="flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0">{t('tela.arquivosParados', { count: arquivos.parados })}</p>
        </div>
      )}

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t('tela.buscaPlaceholder')}
          aria-label={t('tela.buscaPlaceholder')}
          className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {lista.carregando ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('tela.carregando')}</p>
        </div>
      ) : lista.itens === null ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">{t('tela.falhou')}</p>
          <Button variant="outline" size="sm" onClick={lista.recarregar}>
            {t('tela.tentarDeNovo')}
          </Button>
        </div>
      ) : itens.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {buscaEnviada.trim() ? t('tela.semResultado') : t('tela.vazia')}
        </p>
      ) : (
        <>
          {lista.falhou && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-2.5 text-sm text-amber-700 dark:text-amber-300">
              <p className="min-w-0 flex-1">{t('tela.falhouRecarga')}</p>
              <Button variant="outline" size="sm" onClick={lista.recarregar}>
                {t('tela.tentarDeNovo')}
              </Button>
            </div>
          )}
          <ul className="min-w-0 space-y-2">
            {itens.map((item) => (
              <ItemDaLixeiraLinha
                key={item.id}
                item={item}
                agora={agora}
                fichasNoLote={item.loteTotal}
                ocupado={emAcao !== null}
                emAcao={emAcao === item.id || emAcao === item.loteId}
                aoRestaurar={() => void restaurarItem(item)}
                aoRestaurarLote={() => void restaurarLote(item)}
                aoExcluir={() => setExcluindo(item)}
              />
            ))}
          </ul>
          {lista.truncada && (
            <p className="text-center text-xs text-muted-foreground">
              {t('tela.truncada', { count: LIMITE_DA_LISTA })}
            </p>
          )}
        </>
      )}

      <ExcluirDeVezDialog
        item={excluindo}
        nome={excluindo ? nomeDoContato(contatoDoItem(excluindo), t('semNome')) : ''}
        aoFechar={() => setExcluindo(null)}
        aoExcluir={lista.recarregar}
      />
    </div>
  );
}
