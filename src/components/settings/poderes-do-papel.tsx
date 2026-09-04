'use client';

// ============================================================
// O que o PAPEL escolhido pode fazer, no editor de perfis.
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
// O aviso de "áreas sem ação" que morava aqui saiu em 2026-09-03: o
// somente-leitura virou o grupo "Só leitura para este papel" dentro de
// <AreasDoPerfil> (diz a mesma coisa ANTES de a pessoa marcar), e a seção
// oculta deixou de ser oferecida e é descartada do rascunho
// (`semSecoesOcultas`) — não sobrou o que avisar.
// ============================================================

import { useTranslations } from 'next-intl';
import { Check, Minus } from 'lucide-react';

import { poderesDoPapel } from '@/lib/perfis/poderes';
import type { PapelBase } from '@/lib/perfis/tipos';

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
