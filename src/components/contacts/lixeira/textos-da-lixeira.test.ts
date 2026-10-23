import { describe, expect, it } from 'vitest';
import { createTranslator, type AbstractIntlMessages } from 'next-intl';

import en from '../../../../messages/en.json';
import ptBR from '../../../../messages/pt-BR.json';
import { MOTIVOS_DA_LIXEIRA, TIPOS_DE_RESSALVA } from '@/lib/contacts/lixeira';

import { chaveDaRessalva, chaveDoMotivo } from './textos-da-lixeira';

// ============================================================
// As frases da Lixeira que saem de CÓDIGO do banco são chave MONTADA
// (`motivos.<motivo>`, `ressalvas.<tipo>`): o portão de i18n só as conta, e
// sem este teste um motivo novo apareceria cru na tela com o CI verde (a
// seção Webhooks, CLAUDE.md seção 9). As listas são COLHIDAS do código
// (`MOTIVOS_DA_LIXEIRA`/`TIPOS_DE_RESSALVA` saem de um `Record` sobre o tipo)
// e as chaves, das MESMAS funções que a tela usa.
// ============================================================

const NS = 'Contacts.lixeira';

function noDicionario(dicionario: unknown, caminho: string): unknown {
  return caminho
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      dicionario,
    );
}

describe.each([
  ['pt-BR', ptBR],
  ['en', en],
])('Lixeira: as frases das chaves montadas em %s', (locale, mensagens) => {
  const erros: string[] = [];
  const t = createTranslator({
    locale,
    messages: mensagens as AbstractIntlMessages,
    namespace: NS,
    onError: (e) => erros.push(`${e.code}: ${e.message}`),
  });

  it('as listas foram colhidas (senão o teste passaria vazio)', () => {
    expect(MOTIVOS_DA_LIXEIRA).toContain('identidade_ocupada');
    expect(MOTIVOS_DA_LIXEIRA).toContain('falhou');
    expect(TIPOS_DE_RESSALVA).toContain('agendadas_em_falha');
  });

  it.each(MOTIVOS_DA_LIXEIRA)('o motivo %s tem frase', (motivo) => {
    erros.length = 0;
    expect(typeof noDicionario(mensagens, `${NS}.${chaveDoMotivo(motivo)}`)).toBe('string');
    const texto = t(chaveDoMotivo(motivo) as never);
    expect(erros, erros.join('\n')).toEqual([]);
    expect(texto).not.toContain('motivos.');
  });

  it.each(TIPOS_DE_RESSALVA)('a ressalva %s tem frase, com o número no plural', (tipo) => {
    erros.length = 0;
    expect(typeof noDicionario(mensagens, `${NS}.${chaveDaRessalva(tipo)}`)).toBe('string');
    const uma = t(chaveDaRessalva(tipo) as never, { n: 1 } as never);
    const tres = t(chaveDaRessalva(tipo) as never, { n: 3 } as never);
    expect(erros, erros.join('\n')).toEqual([]);
    expect(uma).toContain('1');
    expect(tres).toContain('3');
    expect(uma).not.toBe(tres.replace('3', '1'));
  });
});
