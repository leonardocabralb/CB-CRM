// ============================================================
// O idioma das datas: o locale do date-fns que casa com o do app.
//
// O date-fns fala INGLÊS por padrão, e o app em pt-BR mostrava "3 minutes",
// "about 1 hour" na lista da caixa de entrada (10/09/2026). O idioma do app
// sai de `NEXT_PUBLIC_APP_LOCALE` — o mesmo valor que `src/i18n/request.ts`
// lê —, que é build-arg: inlinado no bundle, vale igual no servidor e no
// navegador.
//
// ⚠️ Toda chamada do date-fns que escreve PALAVRAS passa
// `locale: LOCALE_DAS_DATAS`: as distâncias (`formatDistance*`,
// `formatRelative`) e o `format` com mês ou dia da semana por extenso, AM/PM
// ou data localizada (`MMM`, `EEE`, `a`, `P`, `p`). Há pino estrutural
// cobrando os dois em `idioma-das-datas.chamadores.test.ts` — chamada nova
// sem o locale volta a falar inglês sem erro nenhum.
// ============================================================

import type { Locale } from 'date-fns';
// Um locale por caminho, e não `from 'date-fns/locale'`: o índice reexporta
// os ~100 idiomas do pacote, e este módulo vai para o navegador.
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';

/**
 * O locale do date-fns para um idioma do app. Só o pt-BR tem dicionário além
 * do inglês em `messages/`; qualquer outro valor — inclusive `ko`, cujo
 * dicionário foi apagado e cai no inglês — fala inglês, como o dicionário.
 * Idioma novo em `messages/` entra aqui junto.
 */
export function localeDoDateFns(idioma: string | undefined): Locale {
  return idioma === 'pt-BR' ? ptBR : enUS;
}

/** O locale das datas deste build. */
export const LOCALE_DAS_DATAS: Locale = localeDoDateFns(
  process.env.NEXT_PUBLIC_APP_LOCALE
);
