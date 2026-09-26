'use client';

// O detalhe de um agente de IA (F1b, 5.9): Configuração, Playground e Uso.
//
// ⚠️ As abas ficam MONTADAS depois da primeira visita (escondidas, não
// desmontadas): o rascunho da Configuração vive nela, e trocar de aba para
// testar no Playground apagava, sem aviso, o que tinha sido digitado. A
// conversa do Playground também sobrevive à troca.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Bot, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SubAbas } from '@/components/settings/sub-abas';
import { ConfiguracaoDoAgente } from './configuracao-do-agente';
import { PlaygroundDoAgente } from './playground-do-agente';
import { UsoDeIa } from './uso-de-ia';
import type { IaAgente } from './tipos';

type Aba = 'configuracao' | 'playground' | 'uso';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'sumiu' }
  | { fase: 'pronto'; agente: IaAgente };

export function DetalheDoAgente({ id }: { id: string }) {
  const t = useTranslations('IaAgentes');
  const [aba, setAba] = useState<Aba>('configuracao');
  const [visitadas, setVisitadas] = useState<ReadonlySet<Aba>>(() => new Set<Aba>(['configuracao']));
  const [configuracaoNaoSalva, setConfiguracaoNaoSalva] = useState(false);

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

  const e: Estado = estado.de === id ? estado.e : { fase: 'carregando' };

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
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="size-5 shrink-0 text-primary" />
            <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">{e.agente.nome}</h2>
          </div>
          <SubAbas
            rotulo={t('detalhe.abas')}
            ativa={aba}
            aoTrocar={trocarDeAba}
            abas={[
              { id: 'configuracao', rotulo: t('detalhe.configuracao') },
              { id: 'playground', rotulo: t('detalhe.playground') },
              { id: 'uso', rotulo: t('detalhe.uso') },
            ]}
          />
          <div hidden={aba !== 'configuracao'}>
            <ConfiguracaoDoAgente
              key={e.agente.id}
              agente={e.agente}
              aoSalvar={(novo) => setEstado({ de: id, e: { fase: 'pronto', agente: novo } })}
              aoMudarNaoSalvo={setConfiguracaoNaoSalva}
            />
          </div>
          {visitadas.has('playground') ? (
            <div hidden={aba !== 'playground'}>
              <PlaygroundDoAgente
                key={e.agente.id}
                agente={e.agente}
                configuracaoNaoSalva={configuracaoNaoSalva}
              />
            </div>
          ) : null}
          {visitadas.has('uso') ? (
            <div hidden={aba !== 'uso'}>
              <UsoDeIa agenteId={e.agente.id} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
