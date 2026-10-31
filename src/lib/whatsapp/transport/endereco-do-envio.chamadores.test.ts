import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// Pino estrutural (default-deny): toda mensagem que ENVIAMOS pela Evolution
// grava o endereço que a Evolution USOU (`enderecoDoEnvio`), nunca o telefone
// da ficha. Com o telefone da ficha, o nono dígito divergia do endereço real,
// e apagar para todos ia para uma conversa que não existe — a Evolution
// respondia 2xx e a mensagem seguia no aparelho do cliente (medido em
// 19/10/2026: 3 de 11 exclusões). Ver `endereco-do-envio.ts`.
//
// O que reconhece um envio: o INSERT com `from_me: ehEvolution(…)`. Arquivo
// novo com ele entra na lista abaixo DEPOIS de gravar pelo `enderecoDoEnvio`.
// ============================================================

const RAIZ = join(__dirname, '..', '..', '..', '..');

const REMETENTES = [
  'src/lib/automations/meta-send.ts',
  'src/lib/flows/meta-send.ts',
  'src/lib/whatsapp/send-message.ts',
];

/** Onde ainda se monta um JID a partir de telefone, e por quê. */
const MONTAM_JID_DE_TELEFONE: Record<string, string> = {
  'src/lib/whatsapp/transport/endereco-do-envio.ts':
    'a queda para o telefone da ficha quando a resposta não traz o endereço',
  'src/lib/whatsapp/transport/evolution-transport.ts':
    'toKey: chave da citação sem remoteJid gravado (mensagem anterior à coluna)',
};

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function arquivosDoFonte(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDoFonte(caminho));
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const FONTES = arquivosDoFonte(join(RAIZ, 'src')).map((caminho) => ({
  arquivo: relative(RAIZ, caminho).split('\\').join('/'),
  fonte: semComentarios(readFileSync(caminho, 'utf8')),
}));

/** Cada função do arquivo, pelo nome, com o corpo até a próxima função. */
function funcoes(fonte: string): { nome: string; corpo: string }[] {
  return fonte
    .split(/\n(?=(?:export )?async function )/)
    .map((corpo) => ({ nome: /async function (\w+)/.exec(corpo)?.[1] ?? '', corpo }))
    .filter((f) => f.nome);
}

describe('envio pela Evolution grava o endereço que ela usou', () => {
  it('quem grava mensagem enviada pela Evolution é exatamente a lista conhecida', () => {
    const achados = FONTES.filter((f) => /from_me:\s*ehEvolution\(/.test(f.fonte)).map(
      (f) => f.arquivo,
    );
    expect(achados.sort()).toEqual([...REMETENTES].sort());
  });

  for (const arquivo of REMETENTES) {
    const fonte = FONTES.find((f) => f.arquivo === arquivo)?.fonte ?? '';
    const gravadoras = funcoes(fonte).filter((f) => /from_me:\s*ehEvolution\(/.test(f.corpo));

    it(`${arquivo}: há envio que grava (o pino não está vazio)`, () => {
      expect(gravadoras.length).toBeGreaterThan(0);
    });

    for (const f of gravadoras) {
      it(`${arquivo} › ${f.nome}: endereço por enderecoDoEnvio, com o LID`, () => {
        expect(f.corpo, 'sem enderecoDoEnvio(').toMatch(/enderecoDoEnvio\(\s*\w+\.remoteJid/);
        expect(f.corpo, 'sem remote_jid_lid no INSERT').toMatch(/remote_jid_lid:/);
      });
    }
  }

  it('ninguém mais monta JID de telefone (`…}@s.whatsapp.net`) fora da lista', () => {
    const achados = FONTES.filter((f) => /\}@s\.whatsapp\.net`/.test(f.fonte)).map(
      (f) => f.arquivo,
    );
    expect(achados.sort()).toEqual(Object.keys(MONTAM_JID_DE_TELEFONE).sort());
  });
});
