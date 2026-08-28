'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { SettingsChip, type ChipVariant } from './settings-chip';
import { SettingsPanelHead } from './settings-panel-head';
import { cn } from '@/lib/utils';
import type {
  CartaoDeIntegracao,
  EstadoDaIntegracao,
} from '@/lib/integracoes/montar';

/**
 * Aba Configurações → Integrações.
 *
 * Um cartão por integração externa (Gemini / OpenAI / Anthropic /
 * Google Agenda) com chip de estado AO VIVO e, expandido, quem usa cada
 * credencial (agentes, Radar, transcrição, RAG). As chaves continuam
 * morando em Agentes de IA — este painel enxerga, testa e aponta; não é
 * um segundo lugar para editá-las.
 *
 * A carga é em dois tempos: `?ping=0` pinta a tela na hora com a
 * configuração; a segunda chamada roda os pings de verdade (uma geração
 * mínima por agente) e resolve os chips. O botão repete só o ping.
 */

/**
 * Traduz o CÓDIGO de falha que a rota devolve. A rota nunca manda a
 * mensagem do provedor: ela embute o eco da chave enviada, e sairia num
 * print de suporte. Código desconhecido cai no genérico.
 */
function motivoLegivel(
  t: ReturnType<typeof useTranslations>,
  codigo: string | undefined
): string {
  const conhecidos = [
    'invalid_key',
    'rate_limited',
    'timeout',
    'network',
    'provider_error',
    'chave_ilegivel',
  ];
  return t(
    `motivo.${codigo && conhecidos.includes(codigo) ? codigo : 'provider_error'}`
  );
}

/** Nomes próprios — não passam pelo dicionário. */
const NOMES: Record<CartaoDeIntegracao['id'], string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google_calendar: 'Google Agenda',
};

const CHIP_POR_ESTADO: Record<
  EstadoDaIntegracao,
  { variant: ChipVariant; className?: string }
> = {
  ok: { variant: 'ok' },
  erro: { variant: 'err' },
  conferindo: { variant: 'warn' },
  nao_configurado: { variant: 'muted' },
};

export function IntegracoesPanel() {
  const t = useTranslations('Settings.integracoes');
  // ⚠️ `RequireRole` renderiza o fallback TAMBÉM enquanto o papel carrega
  // (fail closed, por desenho). Com a frase "só administradores" ali, todo
  // admin lia uma acusação de não ser admin durante o fetch do perfil — o
  // esqueleto diz a mesma coisa que a tela vai dizer, sem mentir.
  const { profileLoading } = useAuth();

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <RequireRole
        min="admin"
        fallback={
          profileLoading ? (
            <Esqueleto />
          ) : (
            <p className="text-sm text-muted-foreground">{t('somenteAdmin')}</p>
          )
        }
      >
        <Conteudo />
      </RequireRole>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}

function Conteudo() {
  const t = useTranslations('Settings.integracoes');
  const [cartoes, setCartoes] = useState<CartaoDeIntegracao[] | null>(null);
  const [testando, setTestando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  // Evita escrever estado em componente já desmontado.
  const vivoRef = useRef(true);
  // ⚠️ Separado do `vivoRef` de propósito: no StrictMode do `next dev` o
  // efeito roda monta→limpa→monta, e sem esta guarda a abertura da aba
  // dispararia DUAS rodadas de gerações pagas (uma por agente, vezes
  // duas). O `vivoRef` sozinho não resolve — ele é rearmado na segunda
  // execução e ressuscita a cadeia da primeira.
  const disparouRef = useRef(false);

  const carregar = useCallback(async (ping: boolean) => {
    if (ping) setTestando(true);
    try {
      const res = await fetch(
        `/api/cb/integracoes/status${ping ? '' : '?ping=0'}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { cartoes: CartaoDeIntegracao[] };
      if (vivoRef.current) {
        setCartoes(corpo.cartoes);
        setFalhou(false);
      }
    } catch {
      if (vivoRef.current) setFalhou(true);
    } finally {
      if (ping && vivoRef.current) setTestando(false);
    }
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    if (!disparouRef.current) {
      disparouRef.current = true;
      void (async () => {
        await carregar(false);
        await carregar(true);
      })();
    }
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  if (falhou && !cartoes) {
    return (
      <p className="text-sm text-muted-foreground">{t('carregarFalhou')}</p>
    );
  }

  if (!cartoes) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void carregar(true)}
          disabled={testando}
        >
          <RefreshCw className={cn('size-4', testando && 'animate-spin')} />
          {testando ? t('testando') : t('atualizar')}
        </Button>
      </div>

      {cartoes.map((cartao) => (
        <Cartao
          key={cartao.id}
          cartao={cartao}
          aberto={aberto === cartao.id}
          onToggle={() =>
            setAberto((atual) => (atual === cartao.id ? null : cartao.id))
          }
        />
      ))}
    </div>
  );
}

function ChipDeEstado({ cartao }: { cartao: CartaoDeIntegracao }) {
  const t = useTranslations('Settings.integracoes');
  // O Google Agenda ainda não tem conexão — "não conectada" comunica
  // melhor que "não configurada" (não há onde configurar).
  const rotulo =
    cartao.id === 'google_calendar'
      ? t('chipNaoConectado')
      : cartao.estado === 'ok'
        ? t('chipOk')
        : cartao.estado === 'erro'
          ? t('chipErro')
          : cartao.estado === 'conferindo'
            ? t('chipConferindo')
            : t('chipNaoConfigurado');
  const { variant, className } = CHIP_POR_ESTADO[cartao.estado];
  return (
    <SettingsChip variant={variant} className={className}>
      {rotulo}
    </SettingsChip>
  );
}

function Cartao({
  cartao,
  aberto,
  onToggle,
}: {
  cartao: CartaoDeIntegracao;
  aberto: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('Settings.integracoes');
  const ehGoogle = cartao.id === 'google_calendar';
  const Icone = ehGoogle ? CalendarDays : Sparkles;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <Icone className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {NOMES[cartao.id]}
        </span>
        <ChipDeEstado cartao={cartao} />
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            aberto && 'rotate-180'
          )}
        />
      </button>

      {aberto ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {ehGoogle ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">
                {t('googleDesc')}
              </p>
              <Button type="button" variant="outline" size="sm" disabled>
                {t('emBreve')}
              </Button>
            </>
          ) : (
            <>
              {cartao.agentes.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('agentes')}
                  </p>
                  <ul className="space-y-1.5">
                    {cartao.agentes.map((a) => (
                      <li
                        key={a.configId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                      >
                        <Bolinha ok={a.teste === null ? null : a.teste.ok} />
                        <span className="text-foreground">
                          {a.escopo === 'padrao'
                            ? t('agentePadrao')
                            : (a.canalLabel ?? '—')}
                        </span>
                        <code className="text-[11px] text-muted-foreground">
                          {a.model}
                        </code>
                        {/* ⚠️ Chave boa + interruptor desligado é estado
                            real e invisível de outro jeito: Radar e
                            transcrição rodam assim mesmo (leem a config
                            com `requireActive: false`), mas o assistente
                            e a resposta automática ficam mudos. Sem esta
                            marca o cartão diria só "Funcionando". */}
                        {!a.isActive ? (
                          <span className="text-xs text-amber-600 dark:text-amber-300">
                            {t('desligado')}
                          </span>
                        ) : null}
                        {a.teste && !a.teste.ok ? (
                          <span className="text-xs text-red-600 dark:text-red-300">
                            {t('falha', { motivo: motivoLegivel(t, a.teste.motivo) })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="max-w-[62ch] text-muted-foreground">
                  {t('naoConfiguradaDica')}
                </p>
              )}

              <Usos cartao={cartao} />

              <Link
                href="/agents"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('abrirAgentes')}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Usos({ cartao }: { cartao: CartaoDeIntegracao }) {
  const t = useTranslations('Settings.integracoes');
  const linhas: { rotulo: string; valor: string; falha?: string }[] = [];

  if (cartao.radar.length > 0) {
    linhas.push({ rotulo: t('usoRadar'), valor: cartao.radar.join(', ') });
  }
  if (cartao.transcricao.length > 0) {
    linhas.push({
      rotulo: t('usoTranscricao'),
      valor: cartao.transcricao.join(', '),
    });
  }
  if (cartao.rag) {
    linhas.push({
      rotulo: t('usoRag'),
      valor: t('ragConfigurado'),
      falha:
        cartao.ragTeste && !cartao.ragTeste.ok
          ? t('falha', { motivo: motivoLegivel(t, cartao.ragTeste.motivo) })
          : undefined,
    });
  }

  if (linhas.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('usos')}
      </p>
      <ul className="space-y-1">
        {linhas.map((l) => (
          <li key={l.rotulo} className="flex flex-wrap gap-x-2">
            <span className="text-foreground">{l.rotulo}:</span>
            <span className="text-muted-foreground">{l.valor}</span>
            {l.falha ? (
              <span className="text-xs text-red-600 dark:text-red-300">
                {l.falha}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Verde = ping ok, vermelho = falhou, cinza = ainda não testado. */
function Bolinha({ ok }: { ok: boolean | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        ok === null
          ? 'bg-muted-foreground'
          : ok
            ? 'bg-emerald-500'
            : 'bg-red-500'
      )}
    />
  );
}
