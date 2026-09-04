'use client';

// ============================================================
// O que o PAPEL escolhido pode fazer — e a seção que o rascunho marca sem
// que este papel chegue a vê-la. As duas pontas da mesma pergunta, no editor
// de perfis.
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
//
// O somente-leitura em si saiu daqui em 2026-09-03: virou o grupo "Só leitura
// para este papel" dentro de <AreasDoPerfil>, que diz a mesma coisa ANTES de
// a pessoa marcar, em vez de avisar depois.
// ============================================================

import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Minus } from 'lucide-react';

import type { SecaoId, TelaId } from '@/lib/perfis/catalogo';
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
 * O aviso do caso INERTE: seção marcada que este papel não vê de jeito
 * nenhum (`perfis` fora do admin — `SECOES_SO_DE_ADMIN`). A caixa não faz
 * nada, e quem a marcou sai da tela achando ter delegado a gestão de
 * permissões.
 *
 * O editor já não OFERECE essa caixa fora do admin (`gruposDoEditor`); o
 * caso chega gravado (legado) ou por troca de papel com ela marcada — e é
 * por isso que o aviso fica. Só aparece quando há divergência: um aviso
 * permanente vira moldura e ninguém o lê.
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
  const tSecoes = useTranslations('Settings.sections');

  const areas = areasQueNaoOperam(papel, telas, secoes);
  if (areas.secoesOcultas.length === 0) return null;

  // Id declarado à frente da tela (foi o caso de `acervo` e `perfis`)
  // aparece CRU, e não num rótulo emprestado — a mesma decisão da grade de
  // áreas, tomada depois de o fantasma `deals` virar um segundo "Perfis de
  // acesso" idêntico ao verdadeiro.
  const nomeDaSecao = (secao: SecaoId) =>
    secao in SECTION_META
      ? tSecoes(secao as Parameters<typeof tSecoes>[0])
      : secao;

  return (
    <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <p className="text-xs text-foreground">
        {t('avisoOcultas', {
          areas: areas.secoesOcultas.map(nomeDaSecao).join(', '),
        })}
      </p>
    </div>
  );
}
