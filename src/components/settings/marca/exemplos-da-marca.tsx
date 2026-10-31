'use client';

import { useTranslations } from 'next-intl';

import { ARQUIVOS_PADRAO, NOME_PADRAO, PECAS_DA_MARCA } from '@/lib/marca';

import {
  BaixarExemplo,
  FormatoDaPeca,
  ImagemNoFundo,
  OndeAparece,
} from './peca-visual';

/**
 * Os EXEMPLOS (decisão D5 do operador): as cinco peças do padrão, cada uma
 * no fundo certo, com onde aparece, o formato e o arquivo para baixar.
 *
 * ⚠️ Sempre visível — também no modo padrão e para quem só lê: é o que
 * ensina, a quem vai trocar a marca, o formato, a proporção e o fundo de
 * cada peça ANTES de preparar os arquivos.
 */
export function ExemplosDaMarca() {
  const t = useTranslations('Settings.marca');

  return (
    <section className="min-w-0 space-y-3">
      <div className="min-w-0">
        <h3 className="text-foreground text-sm font-semibold">
          {t('exemplosTitulo')}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-[62ch] text-xs">
          {t('exemplosDescricao', { nomePadrao: NOME_PADRAO })}
        </p>
      </div>
      <ul className="grid min-w-0 gap-3 md:grid-cols-2">
        {PECAS_DA_MARCA.map((peca) => (
          <li
            key={peca}
            className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3"
          >
            <ImagemNoFundo
              peca={peca}
              src={ARQUIVOS_PADRAO[peca]}
              alt={t('exemploAlt', {
                peca: t(`pecas.${peca}.titulo`),
                nomePadrao: NOME_PADRAO,
              })}
            />
            <p className="text-foreground text-sm font-medium">
              {t(`pecas.${peca}.titulo`)}
            </p>
            <OndeAparece peca={peca} />
            <FormatoDaPeca peca={peca} />
            <BaixarExemplo peca={peca} />
          </li>
        ))}
      </ul>
    </section>
  );
}
