'use client';

// ============================================================
// /meu-dia — a ÁREA DE TRABALHO.
//
// v2 (pedido do operador, 29/09/2026 — `docs/PLANO-meu-dia-v2.md`), de cima
// para baixo:
//   · as CONEXÕES que a pessoa enxerga, cada uma com os clientes não lidos e
//     em atraso (no lugar da lista de clientes esperando);
//   · a EQUIPE — só administrador e quem vê o Painel (D1): tarefas vencidas
//     e de hoje de cada membro, com as que ainda não foram vistas;
//   · as NOTIFICAÇÕES não lidas e as SUAS TAREFAS, em destaque;
//   · a AGENDA de hoje e amanhã, pela pauta de reuniões;
//   · o que precisa ser corrigido (só administrador, como antes).
// Saíram "O dia até agora" e "Negócios no funil".
//
// ⚠️ Usa a LENTE do "Ver como" (`acesso`), e não o contexto real: esta tela
// vive DENTRO do app, onde o shell bloqueia telas pela lente — com o ctx
// real, o admin simulando um Observador veria links para telas que a
// `TelaBloqueada` recusaria. O ctx real fica só na porta de entrada.
//
// ⚠️ Fica FORA do catálogo de perfis de propósito (`telaDoCaminho` devolve
// null e a guarda deixa passar): uma tela nova no catálogo nasceria
// invisível para todo perfil já gravado.
// ============================================================

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { BlocoDaAgenda } from '@/components/meu-dia/bloco-da-agenda';
import { BlocoDaEquipe } from '@/components/meu-dia/bloco-da-equipe';
import { BlocoDeConexoes } from '@/components/meu-dia/bloco-de-conexoes';
import { BlocoDeNotificacoes } from '@/components/meu-dia/bloco-de-notificacoes';
import { BlocoDeTarefas } from '@/components/meu-dia/bloco-de-tarefas';
import { BlocoDeCorrecoes } from '@/components/meu-dia/blocos-de-operacao';
import { Button } from '@/components/ui/button';
import { useAgendadorSaude } from '@/hooks/use-agendador-saude';
import { useAreaDeTrabalho } from '@/hooks/use-area-de-trabalho';
import { useAoVoltarParaOApp } from '@/hooks/use-ao-voltar-para-o-app';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useChannelHealth } from '@/hooks/use-channel-health';
import { useMembros } from '@/hooks/use-membros';
import { usePautaDeReunioes } from '@/hooks/use-pauta-de-reunioes';
import { diaNoFuso, FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso';
import type { EstadoDaFonte } from '@/lib/meu-dia/correcoes';
import { canaisVisiveis } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { podeVerSecao, podeVerTela } from '@/lib/perfis/visibilidade';
import type { SaudeDoAgendador } from '@/lib/scheduled/saude';
import { diaLocal, somarDias } from '@/lib/tasks/prazo';

/**
 * ⚠️ `deveAparecer` NÃO serve aqui: ele é true também para
 * `recado === 'falhas'`, que quer dizer "há agendadas falhadas" — e essa é
 * outra fonte deste mesmo bloco. Usá-lo faria a tela escrever "o agendador
 * está parado" sobre um agendador que está rodando, ao lado da linha que
 * conta as falhas de verdade. Só os recados de PARADA contam aqui.
 */
function agendadorEstaParado(s: SaudeDoAgendador): boolean {
  return (
    s.recado === 'nuncaRodou' ||
    s.recado === 'paradoComFila' ||
    s.recado === 'paradoSemFila' ||
    s.recado === 'automacoesParadas'
  );
}

export default function MeuDiaPage() {
  const { user, accountId, accountStatus, profile, acesso } = useAuth();
  const userId = user?.id ?? null;

  // O shell já segura sessão e perfil; conta quebrada é narrada pelo
  // `AccountAccessAlert` acima desta página.
  if (!userId || !accountId || accountStatus !== 'ready') return null;

  return (
    <AreaDeTrabalho
      userId={userId}
      accountId={accountId}
      primeiroNome={profile?.full_name?.trim().split(/\s+/)[0] || null}
      acesso={acesso}
    />
  );
}

/**
 * ⚠️ Componente SEPARADO da página, e não o corpo dela: os hooks abaixo
 * exigem `userId`/`accountId` resolvidos, e a página tem uma saída
 * antecipada (`return null`) enquanto a sessão carrega. Chamar hook depois
 * de um `return` condicional quebra a regra dos hooks.
 */
function AreaDeTrabalho({
  userId,
  accountId,
  primeiroNome,
  acesso,
}: {
  userId: string;
  accountId: string;
  primeiroNome: string | null;
  acesso: ContextoDeAcesso;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');

  // O relógio da tela: nasce no inicializador e só muda no "Atualizar" — é a
  // chave que faz os hooks consultarem de novo.
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  const veTarefas = podeVerTela(acesso, 'tarefas');
  const veContatos = podeVerTela(acesso, 'contacts');
  const veInbox = podeVerTela(acesso, 'inbox');
  const veNotificacoes = podeVerTela(acesso, 'notifications');
  const veAgendadas = podeVerTela(acesso, 'agendadas');
  const veAgenda = podeVerTela(acesso, 'agenda');
  const veAutomacoes = podeVerTela(acesso, 'automations');
  const veCorrecoes = useCan('view-reports');
  // ⚠️ D1 (29/09/2026): a equipe é do administrador e de quem vê o PAINEL —
  // hoje, exatamente o perfil "Gestor Geral". `papel` nulo é perfil ainda
  // chegando: sem a guarda, `podeVerTela` sem perfil responde "sim" e o card
  // piscaria para o atendente.
  const veEquipe =
    acesso.papel !== null &&
    (veCorrecoes || podeVerTela(acesso, 'dashboard'));
  // Por SEÇÃO: a tela de Configurações não é recortável, mas as seções são.
  const veConexoes = podeVerSecao(acesso, 'channels');
  const veIntegracoes = podeVerSecao(acesso, 'integracoes');
  const veWebhooks = podeVerSecao(acesso, 'webhooks');

  const area = useAreaDeTrabalho({
    userId,
    accountId,
    ctx: acesso,
    comEquipe: veEquipe,
    versao: agoraMs,
  });
  const membros = useMembros();
  const {
    channels,
    loading: conexoesCarregando,
    falhou: conexoesFalharam,
    recarregar: recarregarConexoes,
  } = useChannelHealth();
  const { saude, recarregar: recarregarAgendador } = useAgendadorSaude();

  // Hoje e amanhã no fuso da AGENDA — a janela da pauta de /reunioes. A
  // janela só muda com o dia; o "Atualizar" relê pela `recarregar`.
  const janelaDaPauta = useMemo(() => {
    const hojeNoFuso = diaNoFuso(new Date(agoraMs), FUSO_PADRAO);
    return {
      de: paraInstante(hojeNoFuso, '00:00', FUSO_PADRAO).toISOString(),
      ate: paraInstante(somarDias(hojeNoFuso, 1), '23:59', FUSO_PADRAO).toISOString(),
    };
  }, [agoraMs]);
  const pauta = usePautaDeReunioes(janelaDaPauta);

  // ⚠️ Só as conexões que o perfil enxerga: um perfil restrito ao
  // trabalhista não tem o que fazer com a conexão do bancário caída — e o
  // aviso que não é seu é o que ensina a ignorar o bloco.
  //
  // ⚠️ A sonda que FALHOU vira `falhou`, nunca zero: a lista vazia dela tem
  // dois significados, e só um deles autoriza dizer "nada a corrigir".
  const conexoes: EstadoDaFonte = conexoesCarregando
    ? { status: 'carregando' }
    : conexoesFalharam
      ? { status: 'falhou' }
      : {
          status: 'pronto',
          contagem: {
            quantidade: canaisVisiveis(acesso, channels).filter(
              (c) => c.tone === 'down'
            ).length,
          },
        };

  // Conexão de pé, ouvindo, sem erro — e entregando tarde (1002). Fonte
  // SEPARADA da de cima: o conserto é outro, e somá-las faria a frase
  // "fora do ar" mentir sobre uma conexão que está entregando.
  //
  // ⚠️ O teste é `detail === 'lagging'`, não `tone === 'warn'`: `warn`
  // também cobre `stale`, `pairing` e `lastError`, que são transitórios e
  // encheriam o bloco de alarme que se resolve sozinho.
  const conexoesAtrasadas: EstadoDaFonte = conexoesCarregando
    ? { status: 'carregando' }
    : conexoesFalharam
      ? { status: 'falhou' }
      : {
          status: 'pronto',
          contagem: {
            quantidade: canaisVisiveis(acesso, channels).filter(
              (c) => c.detail === 'lagging'
            ).length,
          },
        };

  const agora = new Date(agoraMs);
  const hoje = diaLocal(agora);
  const hora = agora.getHours();
  const saudacao = primeiroNome
    ? hora < 12
      ? tResumo('greetingMorning', { nome: primeiroNome })
      : hora < 18
        ? tResumo('greetingAfternoon', { nome: primeiroNome })
        : tResumo('greetingEvening', { nome: primeiroNome })
    : hora < 12
      ? tResumo('greetingMorningPlain')
      : hora < 18
        ? tResumo('greetingAfternoonPlain')
        : tResumo('greetingEveningPlain');

  /**
   * ⚠️ O "Atualizar" precisa alcançar as sondas e a pauta, que têm laço ou
   * chave próprios e não enxergam o relógio da tela: sem isso, o operador
   * conserta a conexão, clica em Atualizar e o bloco continua vermelho até o
   * próximo tique (Codex, PR #202).
   */
  const atualizarTudo = () => {
    setAgoraMs(Date.now());
    recarregarConexoes();
    recarregarAgendador();
    pauta.recarregar();
  };

  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora faz o mesmo que o "Atualizar". ⚠️ Os blocos voltam
  // a "carregando" por um instante, como no botão — e é o certo aqui: esta tela
  // AFIRMA ("tudo em ordem", "0 vencidas"), e afirmar sobre números velhos
  // seria pior que piscar.
  useAoVoltarParaOApp(atualizarTudo);

  const carregando =
    pauta.carregando ||
    [
      area.conexoes,
      area.notificacoes,
      area.tarefas,
      area.correcoes,
      area.integracoes,
      ...(veEquipe ? [area.equipe] : []),
    ].some((b) => b.status === 'carregando');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">
            {agora.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1 className="text-foreground mt-0.5 text-xl font-semibold">
            {saudacao}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {carregando && (
            <span role="status" className="text-muted-foreground text-xs">
              {t('loading')}
            </span>
          )}
          <Button
            variant="outline"
            onClick={atualizarTudo}
            disabled={carregando}
            aria-busy={carregando}
          >
            {tResumo('refresh')}
          </Button>
        </div>
      </div>

      {/* ⚠️ A ordem é a de quem abre a tela para trabalhar: a fila das
          conexões (onde o cliente espera), a equipe para quem a acompanha
          (a "prioridade" do pedido), o que é da pessoa, a agenda e, por
          último, o que quebrou (só administrador). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        <div className="lg:col-span-6">
          <BlocoDeConexoes
            bloco={area.conexoes}
            agoraMs={area.agoraMs}
            acesso={acesso}
            veInbox={veInbox}
          />
        </div>

        {veEquipe && (
          <div className="lg:col-span-6">
            <BlocoDaEquipe
              bloco={area.equipe}
              membros={membros}
              userId={userId}
              hoje={hoje}
              veTarefas={veTarefas}
              veInbox={veInbox}
              veContatos={veContatos}
            />
          </div>
        )}

        <div className="lg:col-span-3">
          <BlocoDeNotificacoes
            bloco={area.notificacoes}
            membros={membros.membros}
            veNotificacoes={veNotificacoes}
            veTarefas={veTarefas}
            veInbox={veInbox}
          />
        </div>

        <div className="lg:col-span-3">
          <BlocoDeTarefas
            bloco={area.tarefas}
            hoje={hoje}
            userId={userId}
            veTarefas={veTarefas}
            veInbox={veInbox}
            veContatos={veContatos}
          />
        </div>

        <div className="lg:col-span-6">
          <BlocoDaAgenda
            pauta={{
              reunioes: pauta.pauta?.reunioes ?? null,
              carregando: pauta.carregando,
              falhou: pauta.falhou,
            }}
            agoraMs={agoraMs}
            acesso={acesso}
            veInbox={veInbox}
            veContatos={veContatos}
            veAgenda={veAgenda}
          />
        </div>

        {/* ⚠️ Só o ADMINISTRADOR vê o que precisa ser corrigido (pedido do
            operador, 13/09/2026). É a régua das abas analíticas do funil
            (`view-reports`): agendada que não saiu, conexão fora do ar,
            automação que falhou e entrada que não virou atendimento são a
            saúde da OPERAÇÃO — para o atendente seria um alarme sobre o qual
            ele não pode agir. `useCan` segue o acesso EFETIVO: o "Ver como"
            esconde o bloco junto. */}
        {veCorrecoes && (
          <div className="lg:col-span-6">
            <BlocoDeCorrecoes
              correcoes={area.correcoes}
              integracoes={area.integracoes}
              conexoes={conexoes}
              conexoesAtrasadas={conexoesAtrasadas}
              agendadorParado={
                saude === null ? null : agendadorEstaParado(saude)
              }
              veAgendadas={veAgendadas}
              veAutomacoes={veAutomacoes}
              veConexoes={veConexoes}
              veIntegracoes={veIntegracoes}
              veWebhooks={veWebhooks}
              veInbox={veInbox}
              veContatos={veContatos}
            />
          </div>
        )}
      </div>
    </div>
  );
}
