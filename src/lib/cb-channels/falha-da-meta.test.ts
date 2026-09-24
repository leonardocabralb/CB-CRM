import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';

import { explainMetaError, type MetaErrorLike } from '@/lib/whatsapp/meta-error-explain';
import {
  MOTIVOS_DA_CONEXAO_META,
  NUMEROS_CITADOS,
  falhaDaExplicacao,
  falhaDeIdNaoNumerico,
  falhaDeNumeroForaDaWaba,
  lerFalhaDaMeta,
  semTokenDaMeta,
  statusDaFalha,
  textoCurtoDaFalha,
} from './falha-da-meta';

const TOKEN = 'EAAGm0PX4ZCpsBAKZCZBtestetestetestetoken123';
const IDS = { phoneNumberId: '111222333', wabaId: '999888777' };

function erroDaMeta(o: Partial<MetaErrorLike> = {}): MetaErrorLike {
  return {
    message: 'Meta disse não',
    code: null,
    subcode: null,
    type: 'OAuthException',
    fbtraceId: 'TRACE1',
    httpStatus: 400,
    details: null,
    ...o,
  };
}

describe('semTokenDaMeta — a mensagem da Meta ecoa o token', () => {
  it('troca o token inteiro', () => {
    expect(semTokenDaMeta(`Malformed access token ${TOKEN}`, TOKEN)).toBe(
      'Malformed access token «token»',
    );
  });

  it('troca um PEDAÇO com cara de token da Meta (EAA…), mesmo que não seja o token inteiro', () => {
    expect(semTokenDaMeta('Malformed access token EAAGm0PX4ZCpsBAKZC', TOKEN)).toBe(
      'Malformed access token «token»',
    );
  });

  it('limpa access_token= de uma URL citada', () => {
    expect(
      semTokenDaMeta('GET https://graph.facebook.com/x?access_token=abc123&y=1 falhou', ''),
    ).toBe('GET https://graph.facebook.com/x?access_token=«token»&y=1 falhou');
  });

  it('não mexe no resto', () => {
    expect(semTokenDaMeta('(#100) Unsupported get request.', TOKEN)).toBe(
      '(#100) Unsupported get request.',
    );
  });
});

describe('falhaDaExplicacao', () => {
  it('leva o motivo, o campo, a etapa, o código e o trace — e a mensagem SEM o token', () => {
    const x = explainMetaError(
      erroDaMeta({ code: 190, subcode: 463, message: `Malformed access token ${TOKEN}` }),
      'verify_number',
      IDS,
    );
    const f = falhaDaExplicacao(x, IDS, TOKEN);
    expect(f.motivo).toBe('token_expirado');
    expect(f.campo).toBe('access_token');
    expect(f.lado).toBe('user');
    expect(f.etapa).toBe('verify_number');
    expect(f.codigo).toBe(190);
    expect(f.subcodigo).toBe(463);
    expect(f.fbtraceId).toBe('TRACE1');
    expect(f.mensagemDaMeta).not.toContain(TOKEN);
    expect(JSON.stringify(f)).not.toContain('EAAG');
  });

  it('cita de volta o id da etapa: o número no verify e no register, a WABA nas outras', () => {
    const naoAcha = (etapa: Parameters<typeof explainMetaError>[1]) =>
      falhaDaExplicacao(
        explainMetaError(erroDaMeta({ code: 100, subcode: 33 }), etapa, IDS),
        IDS,
        TOKEN,
      );
    expect(naoAcha('verify_number').id).toBe('111222333');
    expect(naoAcha('register').id).toBe('111222333');
    expect(naoAcha('waba_phone_numbers').id).toBe('999888777');
    expect(naoAcha('subscribe_waba').id).toBe('999888777');
    expect(naoAcha('subscribe_waba').campo).toBe('waba_id');
  });

  it('erro de rede (não é da Meta) vira sem_resposta, do lado da Meta', () => {
    const f = falhaDaExplicacao(
      explainMetaError(new TypeError('fetch failed'), 'subscribe_waba', IDS),
      IDS,
      TOKEN,
    );
    expect(f.motivo).toBe('sem_resposta');
    expect(f.lado).toBe('meta');
    expect(statusDaFalha(f)).toBe(502);
    expect(f.mensagemDaMeta).toBe('fetch failed');
  });
});

describe('as falhas que a conexão confere antes da Meta', () => {
  it('id não numérico nomeia o campo e é do lado de quem preenche', () => {
    const f = falhaDeIdNaoNumerico('waba_id');
    expect(f).toMatchObject({ motivo: 'id_nao_numerico', campo: 'waba_id', lado: 'user', etapa: null });
    expect(statusDaFalha(f)).toBe(400);
    expect(textoCurtoDaFalha(f)).toContain('WABA ID');
    expect(textoCurtoDaFalha(falhaDeIdNaoNumerico('phone_number_id'))).toContain('Phone Number ID');
  });

  it('número fora da WABA cita até cinco números e conta o resto', () => {
    const numeros = Array.from({ length: 7 }, (_, i) => ({
      id: String(100 + i),
      ...(i === 0 ? {} : { display_phone_number: `+55 11 9000-000${i}` }),
    }));
    const f = falhaDeNumeroForaDaWaba(numeros, '555', '999');
    expect(f.motivo).toBe('numero_fora_da_waba');
    expect(f.campo).toBe('waba_id');
    expect(f.id).toBe('555');
    expect(f.waba).toBe('999');
    expect(f.numerosDaWaba?.total).toBe(7);
    expect(f.numerosDaWaba?.citados).toHaveLength(NUMEROS_CITADOS);
    expect(f.numerosDaWaba?.citados[0]).toBe('100');
    expect(f.numerosDaWaba?.citados[1]).toBe('+55 11 9000-0001 (101)');
  });
});

describe('lerFalhaDaMeta — o painel não confia no corpo', () => {
  it('recusa motivo fora da lista fechada', () => {
    expect(lerFalhaDaMeta({ motivo: 'inventado' })).toBeNull();
    expect(lerFalhaDaMeta(null)).toBeNull();
    expect(lerFalhaDaMeta('token_invalido')).toBeNull();
  });

  it('ida e volta pelo JSON preserva a falha', () => {
    const f = falhaDeNumeroForaDaWaba([{ id: '1', display_phone_number: '+1' }], '2', '3');
    expect(lerFalhaDaMeta(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });

  it('campo, etapa e números estranhos viram nulo em vez de passar crus', () => {
    const f = lerFalhaDaMeta({
      motivo: 'outro',
      campo: 'senha',
      etapa: 'apagar_tudo',
      codigo: 'x',
      subcodigo: Number.NaN,
      lado: 'qualquer',
    });
    expect(f).toMatchObject({ campo: null, etapa: null, codigo: null, subcodigo: null, lado: 'user' });
  });
});

// ============================================================
// As chaves MONTADAS da tela (`metaErro.<motivo>`, `metaEtapa.<etapa>`)
// escapam do portão estático de i18n: sem este teste, um motivo novo sem
// frase aparecia CRU no diálogo de Conexões. Cada frase é formatada com os
// MESMOS valores que o painel passa (`textoDaFalha`), nos dois idiomas.
// ============================================================

const ETAPAS = ['verify_number', 'waba_phone_numbers', 'register', 'subscribe_waba', 'subscribed_apps'];
const VALORES = {
  etapa: 'ao ler o número',
  nome: 'Phone Number ID',
  alvo: 'Phone Number ID 111',
  id: '111',
  waba: '999',
  codigo: 131000,
  lista: 'A Meta lista…',
};

describe.each(['en', 'pt-BR'])('dicionário %s', (idioma) => {
  const mensagens = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', `${idioma}.json`), 'utf8'),
  );
  const erros: string[] = [];
  const t = createTranslator({
    locale: idioma,
    messages: mensagens,
    namespace: 'Settings.channels',
    onError: (e) => erros.push(`${e.code}: ${e.message}`),
  });

  it.each([...MOTIVOS_DA_CONEXAO_META])('tem a frase de %s, formatável com os valores da tela', (motivo) => {
    erros.length = 0;
    const texto = t(`metaErro.${motivo}` as never, VALORES as never);
    expect(erros, erros.join('\n')).toEqual([]);
    expect(texto).not.toContain('metaErro.');
    expect(texto).not.toMatch(/wacrm/i);
  });

  it.each(ETAPAS)('tem o rótulo da etapa %s', (etapa) => {
    erros.length = 0;
    const texto = t(`metaEtapa.${etapa}` as never);
    expect(erros, erros.join('\n')).toEqual([]);
    expect(texto).not.toContain('metaEtapa.');
  });

  it('a lista de números da WABA formata com e sem "e mais N"', () => {
    erros.length = 0;
    const cinco = t('metaErroWabaLista' as never, { numeros: 'a, b', mais: 0 } as never);
    const oito = t('metaErroWabaLista' as never, { numeros: 'a, b', mais: 3 } as never);
    expect(erros, erros.join('\n')).toEqual([]);
    expect(cinco).not.toMatch(/\d/);
    expect(oito).toContain('3');
  });
});
