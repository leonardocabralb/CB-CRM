'use client';

// ============================================================
// Provedor e modelo (25/10/2026, pedidos do operador): o seletor de modelo
// LIGADO À CHAVE da conta e o quadro "quem lê a mídia". Usados pela
// Configuração do agente, pelo "Novo agente" e pelo modelo do Radar em
// Integrações.
//
// ⚠️ O seletor NÃO é allow-list (`.claude/rules/ia.md`): a lista é a que a
// chave do provedor oferece (`GET /api/cb/ia/modelos`), os recomendados
// (`AI_PROVIDER_MODELS`) no topo, e "Outro (digitar o id)" para o que não
// estiver nela. O modelo SALVO aparece sempre — fora da lista, marcado. Lista
// que falha volta ao campo de texto com as sugestões fixas e um aviso
// discreto: falha nunca vira "esta chave não tem modelos".
//
// ⚠️ Quem lê áudio, imagem e PDF NÃO é o modelo do agente: é a chave da conta
// (`escolherLeitor`, Gemini → OpenAI → Anthropic; o áudio, Gemini → OpenAI),
// e o agente recebe o TEXTO. O quadro diz quem lê NESTA conta.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AI_PROVIDER_MODELS, opcoesDeModelo, type ModeloDaChave } from '@/lib/ai/defaults';
import type { ModelosDoProvedor } from '@/lib/ai/modelos-da-chave';
import type { AiProvider } from '@/lib/ai/types';
import type { LeitoresDaConta } from '@/lib/integracoes/montar';
import { cn } from '@/lib/utils';
import { NOME_DO_PROVEDOR } from './tipos';

export type Leitura = {
  provedores: Record<AiProvider, ModelosDoProvedor>;
  /** `null` = não se sabe (a leitura de alguma chave falhou). */
  leitores: LeitoresDaConta | null;
};

const FALHOU: ModelosDoProvedor = { ok: false, motivo: 'falhou', codigo: 'provider_error' };

/** A rota inteira falhou: os três "falharam" — nunca "sem chave" (a tela diria que não há). */
const LEITURA_QUE_FALHOU: Leitura = {
  provedores: { gemini: FALHOU, openai: FALHOU, anthropic: FALHOU },
  leitores: null,
};

async function lerModelos(atualizar: boolean): Promise<Leitura> {
  try {
    const res = await fetch(`/api/cb/ia/modelos${atualizar ? '?atualizar=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) return LEITURA_QUE_FALHOU;
    const corpo = (await res.json()) as { provedores?: Partial<Record<AiProvider, ModelosDoProvedor>>; leitores?: LeitoresDaConta | null };
    if (!corpo.provedores) return LEITURA_QUE_FALHOU;
    // Provedor ausente da resposta (servidor de outra versão) = "falhou", nunca carregando para sempre.
    const p = corpo.provedores;
    return {
      provedores: { gemini: p.gemini ?? FALHOU, openai: p.openai ?? FALHOU, anthropic: p.anthropic ?? FALHOU },
      leitores: corpo.leitores ?? null,
    };
  } catch {
    return LEITURA_QUE_FALHOU;
  }
}

export interface ModelosDasChaves {
  /** `null` = ainda carregando. */
  leitura: Leitura | null;
  atualizando: boolean;
  atualizar: () => void;
}

/**
 * Os modelos das três chaves e quem lê a mídia, numa chamada só. `ativo`
 * falso não busca nada (o diálogo fechado não gasta leitura de provedor).
 */
export function useModelosDasChaves(ativo = true): ModelosDasChaves {
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    void (async () => {
      const lida = await lerModelos(false);
      if (vivo) setLeitura(lida);
    })();
    return () => {
      vivo = false;
    };
  }, [ativo]);

  const atualizar = useCallback(() => {
    setAtualizando(true);
    void (async () => {
      const lida = await lerModelos(true);
      setLeitura(lida);
      setAtualizando(false);
    })();
  }, []);

  return { leitura, atualizando, atualizar };
}

/** Os modelos da chave, ou `null` quando a lista não está (carregando, sem chave, falhou). */
export function listaDaChave(m: ModelosDoProvedor | null | undefined): ModeloDaChave[] | null {
  return m && m.ok ? m.modelos : null;
}

const OUTRO = '__outro__';

function rotulo(m: ModeloDaChave): string {
  return m.nome === m.id ? m.id : `${m.nome} · ${m.id}`;
}

/**
 * O modelo, escolhido da lista da chave do `provedor` (ou digitado). O
 * estado "digitando" é CARIMBADO com o provedor: trocar de provedor volta à
 * lista, sem limpeza em efeito (seção 8c do CLAUDE.md).
 */
export function SeletorDeModelo({
  id,
  provedor,
  valor,
  aoMudar,
  lista,
  atualizando = false,
  aoAtualizar,
  opcaoVazia,
}: {
  id: string;
  provedor: AiProvider;
  valor: string;
  aoMudar: (modelo: string) => void;
  /** A lista da chave deste provedor; `null` = carregando. */
  lista: ModelosDoProvedor | null;
  atualizando?: boolean;
  aoAtualizar?: () => void;
  /** Rótulo da opção VAZIA (o Radar: "Mesmo do agente"); ausente = sem opção vazia. */
  opcaoVazia?: string;
}) {
  const t = useTranslations('IaAgentes');
  const [digitandoEm, setDigitandoEm] = useState<AiProvider | null>(null);
  const digitando = digitandoEm === provedor;

  const botaoAtualizar = aoAtualizar ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t('modeloDaChave.atualizar')}
      title={t('modeloDaChave.atualizar')}
      disabled={atualizando || lista === null}
      onClick={aoAtualizar}
    >
      <RefreshCw className={cn('size-4', atualizando && 'animate-spin')} />
    </Button>
  ) : null;

  if (lista === null) {
    return (
      <div className="space-y-1">
        <select id={id} disabled className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm opacity-70">
          <option>{valor || opcaoVazia || ''}</option>
        </select>
        <p className="text-xs text-muted-foreground">{t('modeloDaChave.carregando')}</p>
      </div>
    );
  }

  const daChave = lista.ok ? lista.modelos : null;

  // Campo de texto: a lista falhou, veio vazia, não há chave, ou a pessoa
  // escolheu "Outro". As sugestões: as fixas e, havendo, as da chave.
  if (!daChave || daChave.length === 0 || digitando) {
    const sugestoes = [...new Set([...AI_PROVIDER_MODELS[provedor], ...(daChave ?? []).map((m) => m.id)])];
    return (
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-1">
          <Input
            id={id}
            list={`${id}-sugestoes`}
            value={valor}
            placeholder={opcaoVazia}
            onChange={(e) => aoMudar(e.target.value)}
          />
          {botaoAtualizar}
        </div>
        {/* Sugestão, nunca allow-list: o campo aceita qualquer id. */}
        <datalist id={`${id}-sugestoes`}>
          {sugestoes.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {!lista.ok && lista.motivo === 'falhou' ? (
          <p className="text-xs text-muted-foreground">{t('modeloDaChave.falhou')}</p>
        ) : daChave && daChave.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('modeloDaChave.listaVazia')}</p>
        ) : null}
        {digitando && daChave && daChave.length > 0 ? (
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setDigitandoEm(null)}>
            {t('modeloDaChave.voltarALista')}
          </Button>
        ) : null}
      </div>
    );
  }

  const { recomendados, outros } = opcoesDeModelo(provedor, daChave);
  // O modelo SALVO fora da lista aparece sempre, marcado — sem isto, o
  // <select> mostraria outro modelo sobre um valor que não é ele.
  const foraDaLista = valor !== '' && !daChave.some((m) => m.id === valor);

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center gap-1">
        <select
          id={id}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm"
          value={valor}
          onChange={(e) => {
            if (e.target.value === OUTRO) setDigitandoEm(provedor);
            else aoMudar(e.target.value);
          }}
        >
          {opcaoVazia !== undefined ? (
            <option value="">{opcaoVazia}</option>
          ) : valor === '' ? (
            <option value="" disabled>
              {t('modeloDaChave.escolha')}
            </option>
          ) : null}
          {foraDaLista ? <option value={valor}>{t('modeloDaChave.foraDaLista', { modelo: valor })}</option> : null}
          {recomendados.length > 0 ? (
            <optgroup label={t('modeloDaChave.recomendados')}>
              {recomendados.map((m) => (
                <option key={m.id} value={m.id}>
                  {rotulo(m)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {outros.length > 0 ? (
            <optgroup label={t('modeloDaChave.outrosDaChave')}>
              {outros.map((m) => (
                <option key={m.id} value={m.id}>
                  {rotulo(m)}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value={OUTRO}>{t('modeloDaChave.outro')}</option>
        </select>
        {botaoAtualizar}
      </div>
      {foraDaLista ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('modeloDaChave.foraDaListaDica')}</p>
      ) : null}
    </div>
  );
}

/**
 * Quem lê a mídia do cliente NESTA conta, e o que ninguém lê.
 * `leitores`: `undefined` = carregando (não afirma nada); `null` = não se
 * sabe (a leitura das chaves falhou — diz isso, nunca "ninguém").
 * `compacto`: a linha curta do "Novo agente".
 */
export function QuemLeAMidia({
  leitores,
  compacto = false,
}: {
  leitores: LeitoresDaConta | null | undefined;
  compacto?: boolean;
}) {
  const t = useTranslations('IaAgentes');
  // Sem Gemini nem OpenAI, ninguém ouve: a Anthropic não recebe áudio.
  const semAudio = leitores !== undefined && leitores !== null && leitores.audio === null;
  const aviso = semAudio ? (
    <p className="text-xs text-amber-700 dark:text-amber-300">{t('midia.semAudio')}</p>
  ) : null;

  if (compacto) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('midia.resumo')}</p>
        {aviso}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs sm:max-w-xl">
      <p className="font-medium text-foreground">{t('midia.titulo')}</p>
      <p className="text-muted-foreground">{t('midia.explicacao')}</p>
      {leitores === undefined ? null : leitores === null ? (
        <p className="text-muted-foreground">{t('midia.desconhecido')}</p>
      ) : (
        <div className="space-y-0.5 text-foreground">
          <p className="text-muted-foreground">{t('midia.nestaConta')}</p>
          <p>
            {leitores.audio
              ? t('midia.audioPor', { provedor: NOME_DO_PROVEDOR[leitores.audio] })
              : t('midia.audioNinguem')}
          </p>
          <p>
            {leitores.imagemEPdf
              ? t('midia.imagemPor', { provedor: NOME_DO_PROVEDOR[leitores.imagemEPdf] })
              : t('midia.imagemNinguem')}
          </p>
        </div>
      )}
      {aviso}
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        <li>{t('midia.limiteAudio')}</li>
        <li>{t('midia.limiteFormatos')}</li>
        <li>{t('midia.limitePlanilha')}</li>
        <li>{t('midia.limiteVideo')}</li>
      </ul>
    </div>
  );
}
