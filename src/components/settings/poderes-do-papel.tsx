'use client';

// ============================================================
// O que o PAPEL escolhido pode fazer — e o que o rascunho promete sem
// entregar. As duas metades da mesma pergunta, no editor de perfis.
//
// Por que existe: o seletor de Papel mostrava três nomes e nada mais. A
// única explicação de papel do app (`Settings.roles.*Hint`) vive no diálogo
// de convite — e a do Atendente estava desatualizada, dizendo "sem acesso às
// configurações" quando o que ele não tem é ESCRITA nelas. Resultado medido
// em 2026-09-02: dois perfis chamados "Gestor" configurados como `agent` com
// Conexões, Membros, Modelos, Campos, Acervo e Assinatura marcados. Todos
// somente-leitura. A configuração faz o que foi pedida a fazer; faltava a
// tela dizer o que aquilo significa.
//
// ⚠️ SEMPRE VISÍVEL, não atrás de um "?". A informação que faltava não é
// consultada por quem não sabe que ela existe — quem configurou os "Gestor"
// não tinha por que suspeitar que havia algo a perguntar.
// ============================================================

import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, EyeOff, Minus } from 'lucide-react';

import { ROTULO_DA_TELA, type SecaoId, type TelaId } from '@/lib/perfis/catalogo';
import { areasQueNaoOperam, poderesDoPapel } from '@/lib/perfis/poderes';
import type { PapelBase } from '@/lib/perfis/tipos';
import { SECTION_META } from './settings-sections';

export function PoderesDoPapel({ papel }: { papel: PapelBase }) {
  const t = useTranslations('PerfisPanel');
  const poderes = poderesDoPapel(papel);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        {t('poderesLabel')}
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {poderes.map(({ id, permitido }) => (
          <li
            key={id}
            className={`flex items-start gap-2 text-xs ${
              permitido ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {/* ⚠️ Ícone E cor, nunca só cor: o "não pode" é a metade que
                importa aqui, e daltonismo o apagaria. O traço (em vez de um
                X vermelho) porque não é erro — é a escada funcionando. */}
            {permitido ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            ) : (
              <Minus className="mt-0.5 size-3.5 shrink-0 opacity-60" />
            )}
            {/* Chave montada: o teste de `poderes.test.ts` cobra uma entrada
                por id nos DOIS dicionários, que é o que o portão estático de
                i18n não alcança em chave dinâmica. */}
            <span className={permitido ? '' : 'line-through decoration-1'}>
              {t(`poderes.${id}` as Parameters<typeof t>[0])}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('poderesHint')}</p>
    </div>
  );
}

/**
 * O aviso. Só aparece quando há divergência — um aviso permanente vira
 * moldura e ninguém o lê (a mesma razão de o rótulo de canal na conversa ter
 * deixado de acender em 98% dos casos).
 */
export function AvisoDeAreasSemAcao({
  papel,
  telas,
  secoes,
}: {
  papel: PapelBase;
  telas: TelaId[];
  secoes: SecaoId[];
}) {
  const t = useTranslations('PerfisPanel');
  const tSidebar = useTranslations('Sidebar');
  const tSecoes = useTranslations('Settings.sections');

  const areas = areasQueNaoOperam(papel, telas, secoes);
  const nada =
    areas.telas.length === 0 &&
    areas.secoes.length === 0 &&
    areas.secoesOcultas.length === 0;
  if (nada) return null;

  const nomeDaTela = (tela: TelaId) =>
    tSidebar(ROTULO_DA_TELA[tela] as Parameters<typeof tSidebar>[0]);
  // Id declarado à frente da tela (foi o caso de `acervo` e `perfis`)
  // aparece CRU, e não num rótulo emprestado — a mesma decisão da grade de
  // seções logo acima, tomada depois de o fantasma `deals` virar um segundo
  // "Perfis de acesso" idêntico ao verdadeiro.
  const nomeDaSecao = (secao: SecaoId) =>
    secao in SECTION_META
      ? tSecoes(secao as Parameters<typeof tSecoes>[0])
      : secao;

  return (
    <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div className="flex flex-col gap-1 text-xs text-foreground">
        {(areas.telas.length > 0 || areas.secoes.length > 0) && (
          <p>
            {t('avisoSomenteLeitura', {
              areas: [
                ...areas.telas.map(nomeDaTela),
                ...areas.secoes.map(nomeDaSecao),
              ].join(', '),
            })}
          </p>
        )}
        {/* Separada da lista acima de propósito: seção somente-leitura
            APARECE (dados à vista, sem botão); seção oculta NÃO APARECE, e a
            caixa marcada é inerte — quem marcou "Perfis de acesso" num perfil
            `agent` sai da tela achando ter delegado a gestão de permissões.
            Um aviso só, misturando as duas, pediria um conserto para dois
            problemas diferentes. */}
        {areas.secoesOcultas.length > 0 && (
          <p className="flex items-start gap-1.5">
            <EyeOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>
              {t('avisoOcultas', {
                areas: areas.secoesOcultas.map(nomeDaSecao).join(', '),
              })}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
