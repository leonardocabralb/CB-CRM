import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ARQUIVOS_PADRAO,
  COR_DO_ICONE_PADRAO,
  PECAS_DA_MARCA,
  TETO_DE_BYTES_DA_MARCA,
  marcaPadrao,
  resolverMarca,
  type LinhaDaMarca,
  type Marca,
} from '@/lib/marca';
import { CAMPO_DA_PECA } from '@/lib/marca-validacao';

import {
  codigoConhecido,
  conferirArquivo,
  ehRecusaDePermissao,
  ehRespostaDaMarca,
  estadoDaPeca,
  formularioDoRascunho,
  fundoDaPeca,
  montarRascunho,
  mudancasDoRascunho,
  nomeDoArquivo,
  pecaDoCampo,
  problemasDoRascunho,
  rascunhoDaLinha,
  type Rascunho,
} from './rascunho';

// Dados fictícios: nenhuma marca, pessoa ou domínio real.
const LINHA: LinhaDaMarca = {
  nome: 'Exemplo Gestão',
  nome_curto: 'Exemplo',
  cor_do_icone: '#11aa33',
  simbolo_path: 's-1.png',
  horizontal_escuro_path: 'he-1.png',
  horizontal_claro_path: null,
  vertical_escuro_path: null,
  vertical_claro_path: null,
  atualizado_em: '2026-10-19T12:00:00Z',
};

const url = (caminho: string) =>
  `https://armazenamento.exemplo/marca/${caminho}`;
const GRAVADA: Marca = resolverMarca(LINHA, url);
const PADRAO = marcaPadrao();

const arquivo = (nome: string, tipo = 'image/png', bytes = 10) =>
  new File([new Uint8Array(bytes)], nome, { type: tipo });

function com(base: Rascunho, mudancas: Partial<Rascunho>): Rascunho {
  return { ...base, ...mudancas };
}

describe('montarRascunho — a prévia do que ainda não foi salvo', () => {
  it('sem mudança, reproduz a marca gravada (versão à parte)', () => {
    const m = montarRascunho(GRAVADA, rascunhoDaLinha(LINHA));
    expect({ ...m, versao: GRAVADA.versao }).toEqual(GRAVADA);
  });

  it('peça nova vira a URL de objeto; removida vira null', () => {
    const r = com(rascunhoDaLinha(LINHA), {
      novas: {
        horizontalClaro: { arquivo: arquivo('hc.png'), url: 'blob:hc' },
      },
      removidas: ['horizontalEscuro'],
    });
    const m = montarRascunho(GRAVADA, r);
    expect(m.horizontalClaro).toBe('blob:hc');
    expect(m.horizontalEscuro).toBeNull();
    expect(m.simbolo).toBe(url('s-1.png'));
  });

  it('CRÍTICO: saindo do padrão, NENHUMA imagem do padrão vai para a marca própria', () => {
    const m = montarRascunho(
      PADRAO,
      com(rascunhoDaLinha(null), { nome: 'Nova' })
    );
    for (const p of PECAS_DA_MARCA) {
      expect(m[p]).toBeNull();
      expect(Object.values(m)).not.toContain(ARQUIVOS_PADRAO[p]);
    }
    expect(m.propria).toBe(true);
  });

  it('nome curto vazio cai no nome; cor inválida cai no padrão', () => {
    const m = montarRascunho(
      GRAVADA,
      com(rascunhoDaLinha(LINHA), {
        nome: '  Outra  ',
        nomeCurto: ' ',
        corDoIcone: '#12',
      })
    );
    expect(m.nome).toBe('Outra');
    expect(m.nomeCurto).toBe('Outra');
    expect(m.corDoIcone).toBe(COR_DO_ICONE_PADRAO);
  });
});

describe('estadoDaPeca', () => {
  it('gravada, nova, removida e vazia', () => {
    const r = com(rascunhoDaLinha(LINHA), {
      novas: { verticalClaro: { arquivo: arquivo('vc.png'), url: 'blob:vc' } },
      removidas: ['horizontalEscuro'],
    });
    expect(estadoDaPeca(GRAVADA, r, 'simbolo')).toBe('gravada');
    expect(estadoDaPeca(GRAVADA, r, 'verticalClaro')).toBe('nova');
    expect(estadoDaPeca(GRAVADA, r, 'horizontalEscuro')).toBe('removida');
    expect(estadoDaPeca(GRAVADA, r, 'horizontalClaro')).toBe('vazia');
  });

  it('no padrão, toda peça da marca própria começa vazia', () => {
    for (const p of PECAS_DA_MARCA) {
      expect(estadoDaPeca(PADRAO, rascunhoDaLinha(null), p)).toBe('vazia');
    }
  });
});

describe('problemasDoRascunho — o que desliga o Salvar', () => {
  it('marca própria nova sem nome nem símbolo', () => {
    expect(problemasDoRascunho(PADRAO, rascunhoDaLinha(null))).toEqual([
      'nome_obrigatorio',
      'simbolo_obrigatorio',
    ]);
  });

  it('remover o símbolo gravado é proibido; trocar não', () => {
    const base = rascunhoDaLinha(LINHA);
    expect(
      problemasDoRascunho(GRAVADA, com(base, { removidas: ['simbolo'] }))
    ).toEqual(['simbolo_obrigatorio']);
    expect(
      problemasDoRascunho(
        GRAVADA,
        com(base, {
          novas: { simbolo: { arquivo: arquivo('s.png'), url: 'blob:s' } },
        })
      )
    ).toEqual([]);
  });

  it('nome comprido, nome curto comprido e cor fora do formato', () => {
    const r = com(rascunhoDaLinha(LINHA), {
      nome: 'x'.repeat(61),
      nomeCurto: 'y'.repeat(21),
      corDoIcone: 'azul',
    });
    expect(problemasDoRascunho(GRAVADA, r)).toEqual([
      'nome_longo',
      'nome_curto_longo',
      'cor_invalida',
    ]);
  });

  it('cor vazia não é problema (vale o padrão)', () => {
    const r = com(rascunhoDaLinha(LINHA), { corDoIcone: '' });
    expect(problemasDoRascunho(GRAVADA, r)).toEqual([]);
  });

  // Revisão do Codex no #420: `.length` conta unidades UTF-16 (emoji = 2),
  // e a rota e o CHECK contam ponto de código. 31 emojis são 62 unidades e
  // 31 caracteres — a aba não pode recusar o que o banco aceita.
  it('conta emoji como UM caractere, como a rota e o CHECK', () => {
    const emoji = '\u{1F680}';
    const cabe = com(rascunhoDaLinha(LINHA), {
      nome: emoji.repeat(31),
      nomeCurto: emoji.repeat(20),
    });
    expect(emoji.repeat(31).length).toBe(62);
    expect(problemasDoRascunho(GRAVADA, cabe)).toEqual([]);

    const passa = com(rascunhoDaLinha(LINHA), {
      nome: emoji.repeat(61),
      nomeCurto: emoji.repeat(21),
    });
    expect(problemasDoRascunho(GRAVADA, passa)).toEqual([
      'nome_longo',
      'nome_curto_longo',
    ]);
  });
});

describe('mudancasDoRascunho e formularioDoRascunho — só o que mudou vai', () => {
  it('nada mudou', () => {
    const m = mudancasDoRascunho(LINHA, GRAVADA, rascunhoDaLinha(LINHA));
    expect(m.alguma).toBe(false);
  });

  it('espaços em volta e caixa da cor não contam como mudança', () => {
    const r = com(rascunhoDaLinha(LINHA), {
      nome: ' Exemplo Gestão ',
      corDoIcone: '#11AA33',
    });
    expect(mudancasDoRascunho(LINHA, GRAVADA, r).alguma).toBe(false);
  });

  it('o nome vai SEMPRE; nome curto e cor só quando mudam; vazio = limpar', () => {
    const r = com(rascunhoDaLinha(LINHA), { nomeCurto: '' });
    const corpo = formularioDoRascunho(LINHA, GRAVADA, r);
    expect(corpo.get('nome')).toBe('Exemplo Gestão');
    expect(corpo.has('nome_curto')).toBe(true);
    expect(corpo.get('nome_curto')).toBe('');
    expect(corpo.has('cor_do_icone')).toBe(false);
  });

  it('arquivos novos pelo nome em snake_case; remover só o que existe gravado', () => {
    const novo = arquivo('logo.svg', 'image/svg+xml');
    const r = com(rascunhoDaLinha(LINHA), {
      novas: { horizontalClaro: { arquivo: novo, url: 'blob:hc' } },
      // `verticalEscuro` não está gravada: tirá-la não é mudança.
      removidas: ['horizontalEscuro', 'verticalEscuro'],
    });
    const corpo = formularioDoRascunho(LINHA, GRAVADA, r);
    const enviado = corpo.get('horizontal_claro');
    expect(enviado).toBeInstanceOf(File);
    expect((enviado as File).name).toBe('logo.svg');
    expect(corpo.getAll('remover')).toEqual(['horizontal_escuro']);
    expect(mudancasDoRascunho(LINHA, GRAVADA, r).remover).toEqual([
      'horizontalEscuro',
    ]);
  });

  it('do padrão para a marca própria: nome e cor novos vão no corpo', () => {
    const r = com(rascunhoDaLinha(null), {
      nome: 'Nova',
      corDoIcone: '#AABBCC',
      novas: { simbolo: { arquivo: arquivo('s.png'), url: 'blob:s' } },
    });
    const corpo = formularioDoRascunho(null, PADRAO, r);
    expect(corpo.get('nome')).toBe('Nova');
    expect(corpo.get('cor_do_icone')).toBe('#aabbcc');
    expect(corpo.has('nome_curto')).toBe(false);
    expect(corpo.get('simbolo')).toBeInstanceOf(File);
    expect(corpo.getAll('remover')).toEqual([]);
  });
});

/** Os 24 primeiros bytes de um PNG: assinatura + IHDR com as medidas. */
function png(largura: number, altura: number, nome = 'x.png'): File {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dados = new DataView(bytes.buffer);
  dados.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dados.setUint32(16, largura);
  dados.setUint32(20, altura);
  return new File([bytes], nome, { type: 'image/png' });
}

const svg = (texto: string) =>
  new File([texto], 'logo.svg', { type: 'image/svg+xml' });

describe('conferirArquivo — as MESMAS réguas da rota, antes de enviar', () => {
  it('símbolo só PNG; as outras aceitam PNG, WebP e SVG', async () => {
    const webp = new File([new Uint8Array(12)], 's.webp', {
      type: 'image/webp',
    });
    expect(await conferirArquivo('simbolo', webp)).toBe('tipo_nao_aceito');
    expect(await conferirArquivo('simbolo', png(512, 512))).toBeNull();
    expect(
      await conferirArquivo(
        'horizontalEscuro',
        svg('<svg viewBox="0 0 10 2"></svg>')
      )
    ).toBeNull();
    const jpeg = new File([new Uint8Array(4)], 'v.jpg', { type: 'image/jpeg' });
    expect(await conferirArquivo('verticalClaro', jpeg)).toBe(
      'tipo_nao_aceito'
    );
    const semTipo = new File([new Uint8Array(4)], 'v', { type: '' });
    expect(await conferirArquivo('verticalClaro', semTipo)).toBe(
      'tipo_nao_aceito'
    );
  });

  it('acima do teto recusa sem ler o arquivo', async () => {
    const grande = arquivo('g.png', 'image/png', TETO_DE_BYTES_DA_MARCA + 1);
    let leu = false;
    grande.arrayBuffer = () => {
      leu = true;
      return Promise.resolve(new ArrayBuffer(0));
    };
    expect(await conferirArquivo('horizontalClaro', grande)).toBe(
      'arquivo_grande'
    );
    expect(leu).toBe(false);
  });

  it('símbolo: lado menor ≥ 192 e proporção 0,8–1,25, lidos do próprio PNG', async () => {
    expect(await conferirArquivo('simbolo', png(192, 192))).toBeNull();
    expect(await conferirArquivo('simbolo', png(191, 200))).toBe(
      'simbolo_pequeno'
    );
    expect(await conferirArquivo('simbolo', png(400, 500))).toBeNull(); // 0,8
    expect(await conferirArquivo('simbolo', png(500, 400))).toBeNull(); // 1,25
    expect(await conferirArquivo('simbolo', png(399, 500))).toBe(
      'simbolo_nao_quadrado'
    );
  });

  it('símbolo: lado maior até 2048 (o ícone é desenhado a partir dele no servidor)', async () => {
    expect(await conferirArquivo('simbolo', png(2048, 2048))).toBeNull();
    expect(await conferirArquivo('simbolo', png(2049, 2049))).toBe(
      'simbolo_grande'
    );
  });

  it('"PNG" que não é PNG e SVG com script são recusados', async () => {
    expect(await conferirArquivo('simbolo', arquivo('falso.png'))).toBe(
      'arquivo_corrompido'
    );
    expect(
      await conferirArquivo(
        'horizontalClaro',
        svg('<svg><script>alert(1)</script></svg>')
      )
    ).toBe('svg_inseguro');
  });
});

describe('peças e respostas', () => {
  it('campo snake_case ida e volta, e campo desconhecido', () => {
    for (const p of PECAS_DA_MARCA)
      expect(pecaDoCampo(CAMPO_DA_PECA[p])).toBe(p);
    expect(pecaDoCampo('horizontalEscuro')).toBeNull();
    expect(pecaDoCampo(undefined)).toBeNull();
  });

  it('CRÍTICO: 403 só é "sem permissão" quando o corpo diz isso', () => {
    expect(ehRecusaDePermissao(403, { erro: 'nao_admin' })).toBe(true);
    expect(
      ehRecusaDePermissao(403, { erro: 'nao_e_a_conta_da_instalacao' })
    ).toBe(true);
    expect(
      ehRecusaDePermissao(403, {
        error: "This action requires the 'admin' role or higher",
      })
    ).toBe(true);
    // O perfil que o banco não conseguiu ler também volta 403 do
    // `requireRole`: é soluço do banco, nunca "você não pode".
    expect(
      ehRecusaDePermissao(403, { error: 'Could not load account context' })
    ).toBe(false);
    expect(ehRecusaDePermissao(403, null)).toBe(false);
    expect(ehRecusaDePermissao(500, { erro: 'nao_admin' })).toBe(false);
  });

  it('a frase do papel insuficiente que a aba reconhece ainda é a do requireRole', () => {
    // Se a frase mudar lá, a aba passa a dizer "falhou" no lugar de "sem
    // permissão" — o lado seguro, mas errado: este pino avisa.
    const fonte = readFileSync('src/lib/auth/account.ts', 'utf8');
    expect(fonte).toContain("`This action requires the '${min}' role or higher`");
  });

  it('código de erro desconhecido não vira chave de dicionário', () => {
    expect(codigoConhecido('svg_inseguro')).toBe('svg_inseguro');
    expect(codigoConhecido('falha_no_banco')).toBeNull();
    expect(codigoConhecido(42)).toBeNull();
  });

  it('fundo de cada peça e nome do arquivo de exemplo', () => {
    expect(fundoDaPeca('simbolo')).toBe('ambos');
    expect(fundoDaPeca('horizontalEscuro')).toBe('escuro');
    expect(fundoDaPeca('verticalClaro')).toBe('claro');
    expect(nomeDoArquivo('/marca/x-y.png')).toBe('x-y.png');
  });

  it('CRÍTICO: resposta de forma desconhecida é erro, nunca "o padrão"', () => {
    expect(
      ehRespostaDaMarca({
        marca: PADRAO,
        linha: null,
        podeEditar: true,
        motivo: null,
      })
    ).toBe(true);
    expect(ehRespostaDaMarca({ erro: 'falha_no_banco' })).toBe(false);
    expect(ehRespostaDaMarca({ marca: PADRAO, linha: null })).toBe(false);
    expect(ehRespostaDaMarca(null)).toBe(false);
    expect(ehRespostaDaMarca('<html>')).toBe(false);
  });
});
