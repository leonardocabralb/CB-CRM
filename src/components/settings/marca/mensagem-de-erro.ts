'use client';

import { useTranslations } from 'next-intl';

import { LIMITE_DO_NOME, LIMITE_DO_NOME_CURTO } from '@/lib/marca';
import {
  LADO_MAXIMO_DO_SIMBOLO,
  LADO_MINIMO_DO_SIMBOLO,
} from '@/lib/marca-validacao';

import { tetoLegivel, type CodigoDeErro } from './rascunho';

/**
 * Código de erro (da rota ou da validação local) → a frase da tela.
 *
 * ⚠️ Chave MONTADA (`erros.<codigo>`): o portão de i18n não a enxerga, e
 * `textos-da-marca.test.ts` cobra uma entrada por `CODIGOS_DE_ERRO` nos dois
 * dicionários. Os valores vão para todas as frases; cada uma usa os seus.
 */
export function useMensagemDeErro(): (codigo: CodigoDeErro) => string {
  const t = useTranslations('Settings.marca');
  return (codigo) =>
    t(`erros.${codigo}`, {
      limite: LIMITE_DO_NOME,
      limiteCurto: LIMITE_DO_NOME_CURTO,
      minimo: LADO_MINIMO_DO_SIMBOLO,
      maximo: LADO_MAXIMO_DO_SIMBOLO,
      tamanho: tetoLegivel(),
    });
}
