import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, createTranslator, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { EstadoDaPreviaDaLixeira } from '@/hooks/use-lixeira';
import type { PreviaDaFicha } from '@/lib/contacts/lixeira';

import { PreviaDoMover } from './mover-para-lixeira-dialog';

// ============================================================
// A prévia do "Mover para a Lixeira" (1097). O que importa aqui é a seção 8c:
// carregando e falha NUNCA desenham "nada em andamento" — o botão espera a
// prévia, e a tela não afirma o que não leu. Dados fictícios.
// ============================================================

const mensagens = ptBR as AbstractIntlMessages;
const tr = createTranslator({ locale: 'pt-BR', messages: mensagens, namespace: 'Contacts.lixeira' });
const t = (chave: string, valores?: Record<string, string | number>) =>
  tr(chave as never, valores as never);

type Estado = Pick<EstadoDaPreviaDaLixeira, 'previa' | 'carregando' | 'falha' | 'tentarDeNovo'>;

function desenhar(estado: Omit<Estado, 'tentarDeNovo'>, pedidos = 1): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={mensagens} timeZone="America/Sao_Paulo">
      <PreviaDoMover estado={{ ...estado, tentarDeNovo: () => {} }} pedidos={pedidos} />
    </NextIntlClientProvider>,
  );
}

const SEM_NADA: PreviaDaFicha = {
  id: '00000000-0000-4000-8000-000000000001',
  nome: 'Fulano Teste',
  mensagens: 0,
  agendadas: [],
  esperas: 0,
  robos: 0,
  tarefas: [],
  negocios: [],
  conversa: { status: 'closed', responsavel: null },
};

const COM_TUDO: PreviaDaFicha = {
  id: '00000000-0000-4000-8000-000000000002',
  nome: 'Sicrana Teste',
  mensagens: 12,
  agendadas: [{ autor: 'Fulana Autora', quando: '2026-11-03T13:00:00Z' }],
  esperas: 2,
  robos: 1,
  tarefas: [{ titulo: 'Tarefa ficticia', responsavel: 'Beltrano Teste', venceEm: '2026-11-03' }],
  negocios: [{ titulo: 'Card ficticio', funil: 'Funil X', etapa: 'Etapa Y' }],
  conversa: { status: 'open', responsavel: 'Ciclano Teste' },
};

describe('PreviaDoMover', () => {
  const nada = t('mover.nadaEmAndamento', { count: 1 });

  it('carregando: diz que confere, e nunca "nada em andamento"', () => {
    const html = desenhar({ previa: null, carregando: true, falha: null });
    expect(html).toContain(t('mover.conferindo'));
    expect(html).not.toContain(nada);
  });

  it('a prévia que falhou diz por quê, e nunca "nada em andamento"', () => {
    const html = desenhar({ previa: null, carregando: false, falha: 'so_admin' });
    expect(html).toContain(t('mover.previaFalhou'));
    expect(html).toContain(t('motivos.so_admin'));
    expect(html).not.toContain(nada);
  });

  it('com resposta e nada em andamento, afirma — é vazio com resposta', () => {
    const html = desenhar({ previa: [SEM_NADA], carregando: false, falha: null });
    expect(html).toContain(nada);
  });

  it('lista o que a exclusão cancela de colegas, e os negócios que FICAM no funil', () => {
    const html = desenhar({ previa: [COM_TUDO], carregando: false, falha: null });
    expect(html).toContain('Sicrana Teste');
    expect(html).toContain(t('mover.mensagens', { count: 12 }));
    expect(html).toContain(t('mover.conversa', { responsavel: 'Ciclano Teste' }));
    expect(html).toContain('Fulana Autora');
    expect(html).toContain(t('mover.esperas', { count: 2 }));
    expect(html).toContain(t('mover.robos', { count: 1 }));
    expect(html).toContain('Tarefa ficticia');
    expect(html).toContain('Beltrano Teste');
    expect(html).toContain('Card ficticio');
    expect(html).toContain('Funil X');
    expect(html).not.toContain(nada);
  });

  it('a conversa ENCERRADA, ou sem responsável, não entra no aviso', () => {
    const semGente = { ...SEM_NADA, conversa: { status: 'open', responsavel: null } };
    expect(desenhar({ previa: [semGente], carregando: false, falha: null })).toContain(nada);
  });

  it('na seleção, só as fichas com aviso aparecem; as outras são contadas', () => {
    const html = desenhar({ previa: [COM_TUDO, SEM_NADA], carregando: false, falha: null }, 3);
    expect(html).toContain('Sicrana Teste');
    expect(html).not.toContain('Fulano Teste');
    expect(html).toContain(t('mover.outrasSemNada', { count: 1 }));
    // Pedidas 3, a prévia achou 2: uma já não existe.
    expect(html).toContain(t('mover.naoExistem', { count: 1 }));
  });
});
