import { describe, expect, it } from 'vitest';

import {
  CHAVES_DA_PRIMEIRA_ORIGEM,
  CHAVES_DO_ULTIMO_CLIQUE,
  formaDoReferral,
  lerReferralDaMeta,
  planejarGravacaoDoAnuncio,
  tipoConhecido,
  utmSourceDoLink,
  valoresDoAnuncio,
  type AnuncioDeOrigem,
  type CampoDaConta,
} from './anuncio-de-origem';
import { CAMPOS_DE_TRAQUEAMENTO } from './campos-de-traqueamento';
import { gerarChaveDeCampo } from './chave-do-campo';

// O `referral` como a documentação da Meta o descreve (text messages
// webhook): `source_url` de exemplo é o encurtador `fb.me`.
const REFERRAL = {
  source_url: 'https://fb.me/3cr4Wqqkv',
  source_id: '120226305854810726',
  source_type: 'ad',
  body: 'Recebeu auxílio-doença e hoje não recebe nada?',
  headline: 'Fale com o advogado',
  media_type: 'image',
  image_url: 'https://scontent.xx.fbcdn.net/v/t45.1',
  ctwa_clid: 'Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4',
  welcome_message: { text: 'Olá!' },
};

// O catálogo de traqueamento desta conta (17 campos, medido em 26/09/2026).
const CAMPOS: CampoDaConta[] = [
  'ctwa_clid',
  'fbclid',
  'nome_da_campanha',
  'nome_do_anuncio',
  'nome_do_conjunto',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'id_da_campanha',
  'id_do_conjunto',
  'id_do_anuncio',
  'fbp',
  'fbc',
  'ip',
  'user_agent',
].map((k) => ({ id: `id-${k}`, field_key: k, categoria: 'tracking' }));

const GERAL: CampoDaConta = {
  id: 'id-tamanho',
  field_key: 'tamanho_da_divida',
  categoria: 'geral',
};

function anuncio(parcial: Partial<AnuncioDeOrigem> = {}): AnuncioDeOrigem {
  return {
    tipo: 'ad',
    idDaOrigem: '120226305854810726',
    link: 'https://fb.me/3cr4Wqqkv',
    ctwaClid: 'clid-novo',
    ...parcial,
  };
}

describe('lerReferralDaMeta', () => {
  it('lê o referral da documentação da Meta', () => {
    expect(lerReferralDaMeta(REFERRAL)).toEqual({
      tipo: 'ad',
      idDaOrigem: '120226305854810726',
      link: 'https://fb.me/3cr4Wqqkv',
      ctwaClid: 'Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4',
    });
  });

  it('sem referral, ou sem nada que valha guardar, devolve null', () => {
    expect(lerReferralDaMeta(undefined)).toBeNull();
    expect(lerReferralDaMeta(null)).toBeNull();
    expect(lerReferralDaMeta('ad')).toBeNull();
    expect(lerReferralDaMeta([REFERRAL])).toBeNull();
    expect(lerReferralDaMeta({})).toBeNull();
    // Só título e texto: nada disso tem campo na conta.
    expect(
      lerReferralDaMeta({ source_type: 'ad', headline: 'x', body: 'y' })
    ).toBeNull();
  });

  it('é parse, não cast: tipo errado vira ausente, espaço é aparado', () => {
    expect(
      lerReferralDaMeta({
        source_id: 120226305854810726,
        source_url: { href: 'https://fb.me/x' },
        source_type: '  ad ',
        ctwa_clid: '  clid  ',
      })
    ).toEqual({ tipo: 'ad', idDaOrigem: null, link: null, ctwaClid: 'clid' });
    expect(lerReferralDaMeta({ ctwa_clid: '   ' })).toBeNull();
  });

  it('anúncio no Status do WhatsApp: sem ctwa_clid, o resto vale', () => {
    const status: Record<string, unknown> = { ...REFERRAL };
    delete status.ctwa_clid;
    expect(lerReferralDaMeta(status)).toMatchObject({
      idDaOrigem: '120226305854810726',
      ctwaClid: null,
    });
  });
});

describe('formaDoReferral', () => {
  it('objeto: chaves e TIPOS, nunca os valores', () => {
    const forma = formaDoReferral({
      source_id: 120226305854810726,
      sourceUrl: 'https://fb.me/x',
      ad: { id: '1' },
      lista: [1],
      nada: null,
    });
    expect(forma).toEqual({
      source_id: 'number',
      sourceUrl: 'string',
      ad: 'object',
      lista: 'array',
      nada: 'null',
    });
    // Nenhum valor sai no log: título e texto do anúncio ficam de fora.
    expect(JSON.stringify(formaDoReferral(REFERRAL))).not.toContain(
      'auxílio-doença'
    );
    expect(JSON.stringify(formaDoReferral(REFERRAL))).not.toContain('fb.me');
  });

  it('o que não é objeto vira só o tipo', () => {
    expect(formaDoReferral('ad')).toBe('string');
    expect(formaDoReferral(null)).toBe('null');
    expect(formaDoReferral([REFERRAL])).toBe('array');
    expect(formaDoReferral(7)).toBe('number');
  });

  it('tem teto de chaves', () => {
    const muitas = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`k${i}`, i])
    );
    expect(Object.keys(formaDoReferral(muitas) as object)).toHaveLength(30);
  });
});

describe('tipoConhecido', () => {
  it('só ad e post', () => {
    expect(tipoConhecido('ad')).toBe(true);
    expect(tipoConhecido('post')).toBe(true);
    expect(tipoConhecido(null)).toBe(false);
    expect(tipoConhecido('story')).toBe(false);
    expect(tipoConhecido('AD')).toBe(false);
  });
});

describe('utmSourceDoLink', () => {
  it('link do Instagram é instagram', () => {
    expect(utmSourceDoLink('https://www.instagram.com/p/Cxyz/')).toBe(
      'instagram'
    );
    expect(utmSourceDoLink('https://instagram.com/p/Cxyz')).toBe('instagram');
    expect(utmSourceDoLink('https://instagr.am/p/Cxyz')).toBe('instagram');
  });

  it('qualquer outro caso é facebook (Meta Ads), inclusive o fb.me', () => {
    expect(utmSourceDoLink('https://fb.me/3cr4Wqqkv')).toBe('facebook');
    expect(utmSourceDoLink('https://www.facebook.com/123/posts/456')).toBe(
      'facebook'
    );
    expect(utmSourceDoLink(null)).toBe('facebook');
    expect(utmSourceDoLink('não é url')).toBe('facebook');
    // Parecido não é igual: o host precisa SER o do Instagram.
    expect(utmSourceDoLink('https://notinstagram.com/p/1')).toBe('facebook');
  });
});

describe('valoresDoAnuncio', () => {
  it('anúncio: primeira origem completa e o último clique', () => {
    expect(valoresDoAnuncio(anuncio())).toEqual({
      primeiraOrigem: {
        utm_source: 'facebook',
        utm_medium: 'paid',
        id_do_anuncio: '120226305854810726',
      },
      ultimoClique: { ctwa_clid: 'clid-novo' },
    });
  });

  it('publicação (post): nem "paid" nem id de anúncio', () => {
    expect(
      valoresDoAnuncio(
        anuncio({
          tipo: 'post',
          idDaOrigem: '111_222',
          link: 'https://www.instagram.com/p/Cxyz/',
          ctwaClid: null,
        })
      )
    ).toEqual({
      primeiraOrigem: { utm_source: 'instagram' },
      ultimoClique: {},
    });
  });

  it('tipo ausente ou desconhecido: só o último clique — a origem não trava sem o id', () => {
    // Gravar só o utm_source contaria como "origem existente", e o id do
    // anúncio não entraria nunca mais.
    for (const tipo of [null, 'story', 'AD']) {
      expect(valoresDoAnuncio(anuncio({ tipo }))).toEqual({
        primeiraOrigem: {},
        ultimoClique: { ctwa_clid: 'clid-novo' },
      });
    }
  });

  it('as chaves do mapeamento são as das listas exportadas', () => {
    const { primeiraOrigem, ultimoClique } = valoresDoAnuncio(anuncio());
    expect(Object.keys(primeiraOrigem).sort()).toEqual(
      [...CHAVES_DA_PRIMEIRA_ORIGEM].sort()
    );
    expect(Object.keys(ultimoClique)).toEqual([...CHAVES_DO_ULTIMO_CLIQUE]);
  });

  it('toda chave é estável sob o gerador (948) — é por ela que se acha o campo', () => {
    for (const k of [
      ...CHAVES_DA_PRIMEIRA_ORIGEM,
      ...CHAVES_DO_ULTIMO_CLIQUE,
    ]) {
      expect(gerarChaveDeCampo(k)).toBe(k);
    }
    // As que o semeador do catálogo cria têm de ser as mesmas.
    // Todas: campo que o semeador não cria seria pulado calado em outra
    // instalação.
    const doSemeador = new Set(CAMPOS_DE_TRAQUEAMENTO.map((c) => c.key));
    for (const k of [
      ...CHAVES_DA_PRIMEIRA_ORIGEM,
      ...CHAVES_DO_ULTIMO_CLIQUE,
    ]) {
      expect(doSemeador.has(k)).toBe(true);
    }
  });
});

describe('planejarGravacaoDoAnuncio', () => {
  it('ficha sem origem: grava a primeira origem inteira e o último clique', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), [...CAMPOS, GERAL], {
      // Campo que não é de traqueamento não conta como origem.
      'id-tamanho': '150000',
    });
    expect(plano).toEqual({
      primeiraOrigem: {
        'id-utm_source': 'facebook',
        'id-utm_medium': 'paid',
        'id-id_do_anuncio': '120226305854810726',
      },
      ultimoClique: { 'id-ctwa_clid': 'clid-novo' },
      origemJaExistia: false,
      semCampo: [],
    });
  });

  it('ficha que já tem origem (formulário da iMotion): só o último clique', () => {
    // O caso de 186 fichas: utm e nome do anúncio, sem id do anúncio.
    // Campo a campo, o id de OUTRO anúncio entraria ao lado do nome do
    // primeiro.
    const plano = planejarGravacaoDoAnuncio(anuncio(), CAMPOS, {
      'id-utm_source': 'facebook',
      'id-nome_do_anuncio': 'AD 1 - Antigo Campeão',
    });
    expect(plano.origemJaExistia).toBe(true);
    expect(plano.primeiraOrigem).toEqual({});
    expect(plano.ultimoClique).toEqual({ 'id-ctwa_clid': 'clid-novo' });
  });

  it('qualquer campo de traqueamento preenchido é origem (fbp do site, por exemplo)', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), CAMPOS, {
      'id-fbp': 'fb.1.1700000000.123',
    });
    expect(plano.origemJaExistia).toBe(true);
    expect(plano.primeiraOrigem).toEqual({});
  });

  it('o ctwa_clid de um clique anterior NÃO é origem, e é sobrescrito', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), CAMPOS, {
      'id-ctwa_clid': 'clid-velho',
    });
    expect(plano.origemJaExistia).toBe(false);
    expect(Object.keys(plano.primeiraOrigem)).toHaveLength(3);
    expect(plano.ultimoClique).toEqual({ 'id-ctwa_clid': 'clid-novo' });
  });

  it('último clique igual ao gravado não é regravado', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), CAMPOS, {
      'id-utm_source': 'facebook',
      'id-ctwa_clid': 'clid-novo',
    });
    expect(plano.ultimoClique).toEqual({});
  });

  it('valor só de espaços conta como vazio', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), CAMPOS, {
      'id-utm_source': '   ',
    });
    expect(plano.origemJaExistia).toBe(false);
  });

  it('chave da primeira origem criada fora da categoria tracking também conta', () => {
    const campos: CampoDaConta[] = [
      { id: 'id-utm_source', field_key: 'utm_source', categoria: 'geral' },
      { id: 'id-ctwa_clid', field_key: 'ctwa_clid', categoria: 'tracking' },
    ];
    const plano = planejarGravacaoDoAnuncio(anuncio(), campos, {
      'id-utm_source': 'google',
    });
    expect(plano.origemJaExistia).toBe(true);
    expect(plano.primeiraOrigem).toEqual({});
  });

  it('campo que não existe na conta fica de fora e é listado — nada é criado', () => {
    const campos: CampoDaConta[] = [
      { id: 'id-utm_source', field_key: 'utm_source', categoria: 'tracking' },
    ];
    const plano = planejarGravacaoDoAnuncio(anuncio(), campos, {});
    expect(plano.primeiraOrigem).toEqual({ 'id-utm_source': 'facebook' });
    expect(plano.ultimoClique).toEqual({});
    expect(plano.semCampo.sort()).toEqual([
      'ctwa_clid',
      'id_do_anuncio',
      'utm_medium',
    ]);
  });

  it('tipo desconhecido na ficha sem origem: só o último clique, nada da origem', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio({ tipo: null }), CAMPOS, {});
    expect(plano.origemJaExistia).toBe(false);
    expect(plano.primeiraOrigem).toEqual({});
    expect(plano.ultimoClique).toEqual({ 'id-ctwa_clid': 'clid-novo' });
    expect(plano.semCampo).toEqual([]);
  });

  it('conta sem campo nenhum: plano vazio', () => {
    const plano = planejarGravacaoDoAnuncio(anuncio(), [], {});
    expect(plano.primeiraOrigem).toEqual({});
    expect(plano.ultimoClique).toEqual({});
    expect(plano.origemJaExistia).toBe(false);
  });
});
