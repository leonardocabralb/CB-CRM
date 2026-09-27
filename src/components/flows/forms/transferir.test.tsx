import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../../messages/pt-BR.json';

// O formulário importa o contexto do editor (que importa o cliente do
// navegador e o roteador); aqui só a tela é desenhada, com os membros por prop.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CamposDoTransferir } from './transferir';
import type { MembrosDoRobo } from '../membros-do-robo';

// ============================================================
// "Atribuir a" do "Transferir para atendente" (2.7): "Ninguém" é o padrão;
// o nome de quem recebe aparece; enquanto a lista carrega o gravado aparece
// como "a pessoa escolhida" — nunca o UUID —, e quem saiu da conta é DITO.
// ============================================================

const f = ptBR.Flows.builder.form;
const ISA = '582aad06-4836-4865-b850-0466fff8bc7d';

function desenhar(cfg: { note?: string; assign_to?: string }, membros: MembrosDoRobo) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <CamposDoTransferir cfg={cfg} onUpdateConfig={() => {}} membrosDoRobo={membros} recarregarMembrosDoRobo={() => {}} />
    </NextIntlClientProvider>,
  );
}

const PRONTO: MembrosDoRobo = { status: 'pronto', membros: [{ userId: ISA, nome: 'Dra. Isa Lenier' }] };

describe('CamposDoTransferir', () => {
  it('sem ninguém escolhido: "Ninguém" e a ajuda da fila sem dono', () => {
    const html = desenhar({ note: '' }, PRONTO);
    expect(html).toContain(f.handoffAssignNobody);
    expect(html).toContain(f.handoffAssignHelpNobody);
  });

  it('membro da conta: o NOME no seletor, nunca o UUID', () => {
    const html = desenhar({ assign_to: ISA }, PRONTO);
    expect(html).toContain('Dra. Isa Lenier');
    expect(html).not.toContain(`>${ISA}<`);
    expect(html).toContain(f.handoffAssignHelpSomeone);
  });

  it('carregando: o gravado é "a pessoa escolhida", nunca o UUID nem "saiu"', () => {
    const html = desenhar({ assign_to: ISA }, { status: 'carregando' });
    expect(html).toContain(f.handoffAssignChosen);
    expect(html).toContain(f.handoffAssignLoading);
    expect(html).not.toContain(f.handoffAssignGoneHelp);
  });

  it('quem saiu da conta aparece DITO (a ativação recusa)', () => {
    const html = desenhar({ assign_to: ISA }, { status: 'pronto', membros: [] });
    expect(html).toContain(f.handoffAssignGone);
    expect(html).toContain(f.handoffAssignGoneHelp.replace(/"/g, '&quot;'));
  });

  it('leitura que falhou: o aviso e o "tentar de novo"', () => {
    const html = desenhar({}, { status: 'falhou' });
    expect(html).toContain(f.handoffAssignLoadError);
    expect(html).toContain(f.moveLoadRetry);
  });
});
