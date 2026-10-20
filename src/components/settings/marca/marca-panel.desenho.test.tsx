import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import type { ReactNode } from 'react';

import en from '../../../../messages/en.json';
import ptBR from '../../../../messages/pt-BR.json';
import {
  ARQUIVOS_PADRAO,
  NOME_PADRAO,
  PECAS_DA_MARCA,
  marcaPadrao,
  resolverMarca,
  type LinhaDaMarca,
} from '@/lib/marca';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FormularioDaMarca, MarcaPanel } from '../marca-panel';
import type { RespostaDaMarca } from './rascunho';

// ============================================================
// A aba Marca como a TELA a desenha (SSR, sem navegador): cada modo e cada
// motivo de só-leitura monta sem erro de tradução nos dois idiomas, os
// exemplos estão sempre lá, e o carregamento NUNCA mostra o padrão como se
// fosse a marca atual. Dados fictícios.
// ============================================================

const LINHA: LinhaDaMarca = {
  nome: 'Exemplo Gestão',
  nome_curto: null,
  cor_do_icone: null,
  simbolo_path: 'simbolo/a.png',
  horizontal_escuro_path: null,
  horizontal_claro_path: 'horizontal-claro/b.svg',
  vertical_escuro_path: null,
  vertical_claro_path: null,
  atualizado_em: '2026-10-19T12:00:00Z',
};
const url = (caminho: string) =>
  `https://armazenamento.exemplo/marca/${caminho}`;

const PADRAO: RespostaDaMarca = {
  marca: marcaPadrao(),
  linha: null,
  podeEditar: true,
  motivo: null,
};
const PROPRIA: RespostaDaMarca = {
  marca: resolverMarca(LINHA, url),
  linha: LINHA,
  podeEditar: true,
  motivo: null,
};

function desenhar(no: ReactNode, messages: AbstractIntlMessages = ptBR) {
  const erros: string[] = [];
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={messages}
      timeZone="America/Sao_Paulo"
      onError={(e) => erros.push(e.message)}
    >
      {no}
    </NextIntlClientProvider>
  );
  return { html, erros };
}

const doFormulario = (
  dados: RespostaDaMarca,
  messages?: AbstractIntlMessages
) =>
  desenhar(
    <FormularioDaMarca
      dados={dados}
      onGravou={() => {}}
      onRecarregar={() => {}}
    />,
    messages
  );

describe('aba Marca — desenho', () => {
  it('CRÍTICO: carregando, mostra o esqueleto — nunca o padrão como se fosse a marca', () => {
    const { html, erros } = desenhar(<MarcaPanel />);
    expect(erros).toEqual([]);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(NOME_PADRAO);
    expect(html).not.toContain('/marca/');
  });

  it.each([
    ['pt-BR', ptBR],
    ['en', en],
  ] as const)(
    'todos os modos montam sem erro de tradução (%s)',
    (_, messages) => {
      for (const dados of [
        PADRAO,
        PROPRIA,
        { ...PROPRIA, podeEditar: false, motivo: 'nao_admin' as const },
        {
          ...PROPRIA,
          podeEditar: false,
          motivo: 'nao_e_a_conta_da_instalacao' as const,
        },
      ]) {
        const { erros } = doFormulario(dados, messages);
        expect(erros).toEqual([]);
      }
    }
  );

  it('marca própria editável: cinco cartões com seletor de arquivo e o Salvar', () => {
    const { html } = doFormulario(PROPRIA);
    expect(html.match(/type="file"/g)).toHaveLength(PECAS_DA_MARCA.length);
    expect(html).toContain('Salvar marca');
    expect(html).toContain('value="Exemplo Gestão"');
    // As peças gravadas aparecem; a que falta mostra o que fica no lugar.
    expect(html).toContain(url('simbolo/a.png'));
    expect(html).toContain(url('horizontal-claro/b.svg'));
    expect(html).toContain('aparece o símbolo com o nome em texto');
  });

  it('padrão: nada de formulário, mas a prévia e os exemplos', () => {
    const { html } = doFormulario(PADRAO);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('Salvar marca');
    expect(html).toContain(`Padrão (${NOME_PADRAO})`);
  });

  it('só leitura: o motivo certo, sem controles de edição', () => {
    const outraConta = doFormulario({
      ...PROPRIA,
      podeEditar: false,
      motivo: 'nao_e_a_conta_da_instalacao',
    }).html;
    expect(outraConta).toContain('conta principal desta instalação');
    expect(outraConta).not.toContain('type="file"');
    expect(outraConta).not.toContain('Salvar marca');

    const naoAdmin = doFormulario({
      ...PROPRIA,
      podeEditar: false,
      motivo: 'nao_admin',
    }).html;
    expect(naoAdmin).toContain('Só administradores trocam a marca');
  });

  it('CRÍTICO: os exemplos estão SEMPRE lá, para baixar (D5)', () => {
    for (const dados of [
      PADRAO,
      PROPRIA,
      { ...PADRAO, podeEditar: false, motivo: 'nao_admin' as const },
    ]) {
      const { html } = doFormulario(dados);
      for (const p of PECAS_DA_MARCA) {
        const arquivo = ARQUIVOS_PADRAO[p];
        const nome = arquivo.slice(arquivo.lastIndexOf('/') + 1);
        expect(html).toContain(`href="${arquivo}" download="${nome}"`);
      }
    }
  });
});
