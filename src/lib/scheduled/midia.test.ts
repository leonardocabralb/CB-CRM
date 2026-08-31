import { describe, expect, it } from 'vitest';

import {
  caminhoEhDaConta,
  citacaoAindaVale,
  ehTipoDeMidia,
  lerAnexo,
  podeTerLegenda,
  temAnexo,
  TETO_DA_LEGENDA_META,
  tetoDaLegenda,
  TIPOS_DE_MIDIA,
} from './midia';

const CONTA = '11111111-2222-3333-4444-555555555555';
const OUTRA = '99999999-8888-7777-6666-555555555555';

describe('ehTipoDeMidia', () => {
  it('aceita exatamente os quatro tipos que o transporte conhece', () => {
    for (const t of TIPOS_DE_MIDIA) expect(ehTipoDeMidia(t)).toBe(true);
  });

  it('recusa o que chegaria ao provedor e viraria erro de madrugada', () => {
    for (const v of ['sticker', 'location', '', null, undefined, 7, {}]) {
      expect(ehTipoDeMidia(v)).toBe(false);
    }
  });
});

describe('podeTerLegenda', () => {
  it('⚠️ áudio não leva legenda — o texto sumiria sem ninguém perceber', () => {
    // A nota de voz sai por `message/sendWhatsAppAudio`, que não tem campo de
    // legenda. Um texto ali seria gravado em `messages.content_text`, ficaria
    // visível no fio para a equipe e NÃO viajaria: o CRM afirmando ter mandado
    // algo que o cliente nunca recebeu.
    expect(podeTerLegenda('audio')).toBe(false);
  });

  it('os outros três levam', () => {
    expect(podeTerLegenda('image')).toBe(true);
    expect(podeTerLegenda('video')).toBe(true);
    expect(podeTerLegenda('document')).toBe(true);
  });
});

describe('tetoDaLegenda', () => {
  it('sem assinatura, é o teto cru da Meta', () => {
    expect(tetoDaLegenda(0)).toBe(TETO_DA_LEGENDA_META);
  });

  it('⚠️ com assinatura, desconta — senão a Meta recusa AMANHÃ', () => {
    // O teto de 1024 é sobre o texto FINAL, e o servidor prefixa o nome de
    // quem assina antes de mandar (923). Validando 1024 cru, uma legenda de
    // 1020 passa no agendamento e estoura no envio — de madrugada, sem
    // ninguém na tela para reescrever.
    expect(tetoDaLegenda(12)).toBe(TETO_DA_LEGENDA_META - 12);
  });

  it('nunca devolve negativo, por mais longo que seja o nome', () => {
    expect(tetoDaLegenda(99_999)).toBe(0);
  });
});

describe('caminhoEhDaConta', () => {
  it('aceita o caminho que `buildMediaPath` escreve', () => {
    expect(caminhoEhDaConta(`account-${CONTA}/1700000000000-foto.png`, CONTA)).toBe(
      true,
    );
  });

  it('⚠️ recusa o arquivo de OUTRA conta — é a única barreira que existe', () => {
    // O bucket é público para leitura e o disparador roda em service-role:
    // sem esta checagem, um POST fora da tela agendaria o anexo de outro
    // escritório e o CRM o entregaria a um cliente.
    expect(caminhoEhDaConta(`account-${OUTRA}/x.png`, CONTA)).toBe(false);
  });

  it('⚠️ recusa o arquivo do ACERVO, mesmo sendo da própria conta', () => {
    // A rota `acervo/[id]/copiar` existe para a agendada nunca apontar para o
    // ORIGINAL: cancelar uma agendada apaga o objeto do bucket. Sem esta
    // recusa, um POST direto em /api/cb/scheduled com o `media_path` do
    // acervo (visível a qualquer membro pela policy de SELECT da 953)
    // apagava o contrato-padrão do escritório — e a única coisa entre isso e
    // o operador era a interface.
    expect(caminhoEhDaConta(`account-${CONTA}/acervo/contrato.pdf`, CONTA)).toBe(
      false,
    );
    // A cópia que a rota devolve fica na raiz da conta e continua valendo.
    expect(caminhoEhDaConta(`account-${CONTA}/1700000000000-contrato.pdf`, CONTA)).toBe(
      true,
    );
  });

  it('⚠️ exige a barra — prefixo parecido não vale', () => {
    // Sem a barra, `account-1111` casaria com `account-11119999/…`.
    expect(caminhoEhDaConta(`account-${CONTA}-vizinho/x.png`, CONTA)).toBe(false);
    expect(caminhoEhDaConta(`account-${CONTA}`, CONTA)).toBe(false);
  });

  it('recusa caminho vazio e conta vazia', () => {
    expect(caminhoEhDaConta('', CONTA)).toBe(false);
    expect(caminhoEhDaConta(`account-${CONTA}/x.png`, '')).toBe(false);
  });

  it('⚠️ não deixa subir de pasta — nem antes NEM DEPOIS do prefixo', () => {
    // O segundo caso e o que mordia: `account-<id>/../outra/x.png` passava no
    // `startsWith` e so era normalizado depois, na montagem da URL. A
    // conferencia de posse aprovava um caminho que aponta para fora da pasta.
    expect(caminhoEhDaConta(`../account-${CONTA}/x.png`, CONTA)).toBe(false);
    expect(caminhoEhDaConta(`account-${CONTA}/../account-${OUTRA}/x.png`, CONTA)).toBe(
      false,
    );
    expect(caminhoEhDaConta(`account-${CONTA}/sub/../x.png`, CONTA)).toBe(false);
  });

  it('recusa caminho absurdamente longo — a coluna é `text` e sem limite', () => {
    expect(caminhoEhDaConta(`account-${CONTA}/` + 'a'.repeat(500), CONTA)).toBe(false);
  });
});

describe('lerAnexo', () => {
  const inteiro = {
    media_path: `account-${CONTA}/a.png`,
    media_kind: 'image',
  };

  it('sem nenhum campo, não é erro — é agendada de texto', () => {
    expect(lerAnexo({}, CONTA)).toEqual({ anexo: null });
  });

  it('anexo inteiro vira o objeto pronto', () => {
    expect(lerAnexo(inteiro, CONTA)).toEqual({
      anexo: { path: inteiro.media_path, kind: 'image', filename: null },
    });
  });

  it('⚠️ a URL do cliente é IGNORADA — a rota deriva do caminho conferido', () => {
    // O primeiro desenho conferia a posse do `media_path` e ENVIAVA a
    // `media_url` crua: dava para mandar um caminho legítimo desta conta com
    // uma URL apontando para qualquer lugar da internet, e o CRM entregaria
    // aquele conteúdo ao cliente.
    const r = lerAnexo(
      { ...inteiro, media_url: 'https://site-de-terceiro/qualquer.png' } as never,
      CONTA,
    );
    expect(r).toEqual({
      anexo: { path: inteiro.media_path, kind: 'image', filename: null },
    });
    expect(JSON.stringify(r)).not.toContain('site-de-terceiro');
  });

  it('⚠️ meio anexo é RECUSADO, não completado', () => {
    // Caminho sem tipo o disparador não sabe enviar; tipo sem caminho ele não
    // consegue conferir nem o cancelamento limpar — as duas falhas seriam
    // silenciosas.
    expect(lerAnexo({ media_path: inteiro.media_path }, CONTA)).toMatchObject({
      erro: expect.stringContaining('incompleto'),
    });
    expect(lerAnexo({ media_kind: 'image' }, CONTA)).toMatchObject({
      erro: expect.stringContaining('incompleto'),
    });
  });

  it('tipo desconhecido é recusado aqui, não no provedor', () => {
    expect(lerAnexo({ ...inteiro, media_kind: 'sticker' }, CONTA)).toMatchObject({
      erro: expect.stringContaining('incompleto'),
    });
  });

  it('arquivo de outra conta é recusado com recado próprio', () => {
    expect(
      lerAnexo({ ...inteiro, media_path: `account-${OUTRA}/a.png` }, CONTA),
    ).toEqual({ erro: 'Este arquivo não pertence a esta conta.' });
  });

  it('guarda o nome do arquivo, aparado e limitado', () => {
    const r = lerAnexo({ ...inteiro, media_filename: '  contrato.pdf  ' }, CONTA);
    expect(r).toMatchObject({ anexo: { filename: 'contrato.pdf' } });

    const longo = lerAnexo({ ...inteiro, media_filename: 'x'.repeat(400) }, CONTA);
    expect(
      (longo as { anexo: { filename: string } }).anexo.filename,
    ).toHaveLength(255);
  });

  it('nome vazio ou de outro tipo vira nulo, não string vazia', () => {
    expect(lerAnexo({ ...inteiro, media_filename: '   ' }, CONTA)).toMatchObject({
      anexo: { filename: null },
    });
    expect(lerAnexo({ ...inteiro, media_filename: 42 }, CONTA)).toMatchObject({
      anexo: { filename: null },
    });
  });
});

describe('temAnexo', () => {
  it('separa a agendada de texto da agendada de arquivo', () => {
    expect(temAnexo({ media_url: null, media_kind: null })).toBe(false);
    expect(temAnexo({ media_url: 'https://x/a.png', media_kind: 'image' })).toBe(true);
  });
});

describe('citacaoAindaVale', () => {
  it('mensagem viva vale', () => {
    expect(citacaoAindaVale({ deleted_at: null })).toBe(true);
    expect(citacaoAindaVale({})).toBe(true);
  });

  it('⚠️ mensagem APAGADA não vale — e a linha continua no banco', () => {
    // Apagar aqui é apagar MOLE (905): a linha existe, então `send-message`
    // citaria alegremente algo que o cliente vê como "Esta mensagem foi
    // apagada". A decisão do escritório foi sair SEM a citação, com aviso.
    expect(citacaoAindaVale({ deleted_at: '2026-08-03T10:00:00Z' })).toBe(false);
  });

  it('linha que sumiu de vez cai no mesmo lugar', () => {
    expect(citacaoAindaVale(null)).toBe(false);
    expect(citacaoAindaVale(undefined)).toBe(false);
  });
});

describe('caminhoEhDaConta — escapes codificados', () => {
  it('⚠️ recusa `%`, que desfaria a guarda do `..` do outro lado', () => {
    // O caminho é interpolado CRU na URL do Storage: `%2e%2e` chegaria
    // decodificado como `..` no servidor. `buildMediaPath` nunca produz `%`.
    expect(caminhoEhDaConta(`account-${CONTA}/%2e%2e/x.png`, CONTA)).toBe(false);
    expect(caminhoEhDaConta(`account-${CONTA}/a%20b.png`, CONTA)).toBe(false);
  });
});
