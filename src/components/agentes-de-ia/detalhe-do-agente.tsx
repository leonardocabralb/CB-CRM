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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Bot, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SubAbas } from '@/components/settings/sub-abas';
import { AcessoDoAgente } from './acesso-do-agente';
import { BaseDoAgente } from './base-do-agente';
import { ConfiguracaoDoAgente } from './configuracao-do-agente';
import { FerramentasDoAgente } from './ferramentas-do-agente';
import { PlaygroundDoAgente } from './playground-do-agente';
import { RetomadaDoAgente } from './retomada-do-agente';
import { TurnosDoAgente } from './turnos-do-agente';
import { UsoDeIa } from './uso-de-ia';
import { juntarRascunhos, type RascunhoDaAba } from './rascunho';
import type { IaAgente } from './tipos';

type Aba = 'configuracao' | 'acesso' | 'base' | 'ferramentas' | 'retomada' | 'playground' | 'uso' | 'turnos';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'sumiu' }
  | { fase: 'pronto'; agente: IaAgente };

export function DetalheDoAgente({ id }: { id: string }) {
  const t = useTranslations('IaAgentes');
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

  const naoSalvoEm = [
    configuracaoNaoSalva ? t('detalhe.configuracao') : null,
    acessoNaoSalvo ? t('detalhe.acesso') : null,
    baseNaoSalva ? t('detalhe.base') : null,
    ferramentasNaoSalvas ? t('detalhe.ferramentas') : null,
    retomadaNaoSalva ? t('detalhe.retomada') : null,
  ].filter((x): x is string => x !== null);

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
              { id: 'acesso', rotulo: t('detalhe.acesso') },
              { id: 'base', rotulo: t('detalhe.base') },
              { id: 'ferramentas', rotulo: t('detalhe.ferramentas') },
              { id: 'retomada', rotulo: t('detalhe.retomada') },
              { id: 'playground', rotulo: t('detalhe.playground') },
              { id: 'uso', rotulo: t('detalhe.uso') },
              { id: 'turnos', rotulo: t('detalhe.turnos') },
            ]}
          />
          <div hidden={aba !== 'configuracao'}>
            <ConfiguracaoDoAgente
              key={e.agente.id}
              agente={e.agente}
              aoSalvar={aoSalvarAgente}
              aoMudarNaoSalvo={setConfiguracaoNaoSalva}
              aoMudarRascunho={setRascunhoDaConfiguracao}
            />
          </div>
          {visitadas.has('acesso') ? (
            <div hidden={aba !== 'acesso'}>
              <AcessoDoAgente
                key={e.agente.id}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setAcessoNaoSalvo}
                aoMudarRascunho={setRascunhoDoAcesso}
              />
            </div>
          ) : null}
          {visitadas.has('base') ? (
            <div hidden={aba !== 'base'}>
              <BaseDoAgente key={e.agente.id} agenteId={e.agente.id} aoMudarNaoSalvo={setBaseNaoSalva} />
            </div>
          ) : null}
          {visitadas.has('ferramentas') ? (
            <div hidden={aba !== 'ferramentas'}>
              <FerramentasDoAgente
                key={e.agente.id}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setFerramentasNaoSalvas}
                aoMudarRascunho={setRascunhoDasFerramentas}
              />
            </div>
          ) : null}
          {visitadas.has('retomada') ? (
            <div hidden={aba !== 'retomada'}>
              <RetomadaDoAgente
                key={e.agente.id}
                agente={e.agente}
                aoSalvar={aoSalvarAgente}
                aoMudarNaoSalvo={setRetomadaNaoSalva}
                aoMudarRascunho={setRascunhoDaRetomada}
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
        </>
      )}
    </div>
  );
}
