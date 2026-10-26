'use client';

// ============================================================
// "Motivo ao entrar na etapa" no Gerenciar funil (1112): a escolha, por
// etapa, do campo Lista que guarda o MOTIVO de quem entra nela. Plano:
// docs/PLANO-motivos-de-perda.md (Fase 1). Decisão do operador, 26/10/2026:
// dois campos por área (motivo da desqualificação e motivo da perda), e é a
// ETAPA que diz qual pergunta.
//
// ⚠️ Seção própria, e não uma quinta caixa na linha da etapa: a linha já tem
// quatro seletores de largura fixa e só deixa de quebrar em `lg`.
//
// ⚠️ Catálogo carregando ou que falhou NUNCA vira "Não pergunta": o seletor
// trava mostrando o campo que a etapa já tem, e o "Salvar" regrava o valor
// lido do banco. O mesmo para o campo que deixou de ser Lista (o gatilho não
// confere tipo — `motivo-da-etapa.ts`): aparece com aviso, não some.
// Tudo fica no rascunho do diálogo e vai no "Salvar".
// ============================================================

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { agruparCampos } from '@/lib/contacts/grupos-de-campos';
import { camposDeMotivo, motivoDaEtapa } from '@/lib/pipelines/motivo-da-etapa';
import type { CustomField, GrupoDeCampos, PipelineStage } from '@/types';

export type CatalogoDeMotivo =
  | { situacao: 'carregando' }
  | { situacao: 'falhou' }
  | { situacao: 'pronto'; campos: CustomField[]; grupos: GrupoDeCampos[] };

export function MotivoDaEtapaConfig({
  etapas,
  catalogo,
  onChange,
}: {
  /** O rascunho do diálogo, na ordem da tela. */
  etapas: PipelineStage[];
  catalogo: CatalogoDeMotivo;
  onChange: (stageId: string, campoId: string | null) => void;
}) {
  const t = useTranslations('Pipelines.settings.motivo');
  const tCampos = useTranslations('Contacts.customFields');

  const pronto = catalogo.situacao === 'pronto';
  const campos = pronto ? catalogo.campos : [];
  const blocos = pronto ? agruparCampos(camposDeMotivo(campos), catalogo.grupos) : [];
  const perguntam = etapas.filter((e) => e.campo_do_motivo_id).length;

  return (
    <details className="rounded-lg border border-border p-2">
      <summary className="cursor-pointer text-sm text-muted-foreground">
        {t('titulo')} · {perguntam > 0 ? t('resumo', { quantas: perguntam }) : t('resumoNenhuma')}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{t('dica')}</p>
      {catalogo.situacao === 'falhou' && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('falhou')}</p>
      )}
      {pronto && blocos.length === 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('semCampos')}</p>
      )}
      <div className="mt-3 grid gap-1.5">
        {etapas.map((etapa) => {
          const motivo = pronto ? motivoDaEtapa(etapa, campos) : null;
          // O valor da etapa que o catálogo não oferece (carregando, falhou,
          // deixou de ser Lista, sumiu) entra como opção própria: sem ela o
          // <select> mostraria a primeira opção — "Não pergunta" — sobre uma
          // etapa configurada.
          const foraDoCatalogo =
            etapa.campo_do_motivo_id && (!motivo || motivo.estado === 'nao_serve' || motivo.estado === 'sumiu')
              ? {
                  id: etapa.campo_do_motivo_id,
                  rotulo: !motivo
                    ? t('carregando')
                    : motivo.estado === 'nao_serve'
                      ? motivo.campo.field_name
                      : t('campoDesconhecido'),
                }
              : null;
          return (
            <div key={etapa.id} className="grid gap-0.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: etapa.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{etapa.name}</span>
                <select
                  value={etapa.campo_do_motivo_id ?? ''}
                  disabled={!pronto}
                  onChange={(e) => onChange(etapa.id, e.target.value || null)}
                  aria-label={t('seletor', { etapa: etapa.name })}
                  className="h-7 w-72 max-w-[60%] shrink-0 rounded-md border border-border bg-card px-1 text-xs text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
                >
                  <option value="">{t('naoPergunta')}</option>
                  {foraDoCatalogo && <option value={foraDoCatalogo.id}>{foraDoCatalogo.rotulo}</option>}
                  {blocos.map((bloco) => (
                    <optgroup key={bloco.grupo?.id ?? 'geral'} label={bloco.grupo?.nome ?? tCampos('groupGeneral')}>
                      {bloco.campos.map((campo) => (
                        <option key={campo.id} value={campo.id}>
                          {campo.field_name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {motivo?.estado === 'nao_serve' && (
                <p className="flex items-start gap-1 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {t('naoServe', { campo: motivo.campo.field_name })}
                </p>
              )}
              {motivo?.estado === 'sumiu' && (
                <p className="flex items-start gap-1 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {t('sumiu')}
                </p>
              )}
              {motivo?.estado === 'nenhum' && etapa.resultado === 'perdido' && (
                <p className="pl-4 text-[11px] text-muted-foreground">{t('perdaSemMotivo')}</p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
