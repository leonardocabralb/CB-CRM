import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

const h = vi.hoisted(() => ({ podeVincular: false }));
vi.mock('@/hooks/use-can', () => ({
  useCan: (acao: string) => {
    // O gate é o do `requireRole('admin')` da rota, pela lente "Ver como".
    if (acao !== 'edit-settings') throw new Error(`gate inesperado: ${acao}`);
    return h.podeVincular;
  },
}));

import en from '../../../../messages/en.json';
import ptBR from '../../../../messages/pt-BR.json';
import type { AtlasDoContato, VinculoNaTela } from '@/lib/atlas/do-contato';

import { AbaAtlas } from './aba-atlas';

// ============================================================
// A aba Atlas (Fase 2, PR B): os estados na ordem certa (carregando →
// falhou → não conectado → sem vínculo → lixeira → vínculo), a falha nunca
// vira "sem vínculo", vincular e desvincular só para quem administra, e
// nenhuma chave crua na tela. Dados fictícios.
// ============================================================

const CLIENTE = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const APP = `https://app.example.com/#/clients/${CLIENTE}`;

const vinculo = (parcial: Partial<VinculoNaTela> = {}): VinculoNaTela => ({
  atlasClientId: CLIENTE,
  appUrl: APP,
  situacao: 'rescindido',
  situacaoDesde: '2026-08-12T13:00:00.000Z',
  origem: 'automatica',
  casouPor: 'chat_link',
  excluidoEm: null,
  lidaEm: '2026-09-30T14:45:00.000Z',
  velha: false,
  ...parcial,
});

function desenhar(
  props: { dados?: AtlasDoContato | null; carregando?: boolean; falhou?: boolean },
  messages: unknown = ptBR,
  locale = 'pt-BR',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <AbaAtlas contactId="ficha-1" dados={props.dados ?? null} carregando={props.carregando ?? false} falhou={props.falhou ?? false} recarregar={() => {}} />
    </NextIntlClientProvider>,
  );
}

const semChaveCrua = (html: string) => expect(html).not.toMatch(/Inbox\.atlas|situacao\.|origem\.|casouPor\.|erro\./);

beforeEach(() => {
  h.podeVincular = false;
});

describe('AbaAtlas', () => {
  it('carregando: spinner — nunca "sem vínculo" durante a carga', () => {
    const html = desenhar({ carregando: true, dados: { conectado: true, vinculo: null, erroDaLeitura: null } });
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('não está ligada');
  });

  it('falhou: aviso e "Tentar de novo" — nunca "sem vínculo"', () => {
    const html = desenhar({ falhou: true });
    expect(html).toContain('Não foi possível carregar o vínculo com o Atlas.');
    expect(html).toContain('Tentar de novo');
    expect(html).not.toContain('não está ligada');
  });

  it('não conectado: diz que o Atlas não está conectado', () => {
    expect(desenhar({ dados: { conectado: false, vinculo: null, erroDaLeitura: null } })).toContain('O Atlas não está conectado.');
  });

  it('sem vínculo: quem não administra é mandado ao administrador, sem campo', () => {
    const html = desenhar({ dados: { conectado: true, vinculo: null, erroDaLeitura: null } });
    expect(html).toContain('Esta ficha não está ligada a um cliente do Atlas.');
    expect(html).toContain('peça a um administrador');
    expect(html).not.toContain('<input');
  });

  it('sem vínculo, para quem administra: o campo para colar o link e "Vincular"', () => {
    h.podeVincular = true;
    const html = desenhar({ dados: { conectado: true, vinculo: null, erroDaLeitura: null } });
    expect(html).toContain('<input');
    expect(html).toContain('Link da ficha no Atlas');
    expect(html).toContain('Vincular');
  });

  it('vínculo: situação traduzida, desde, como nasceu, "Abrir no Atlas" — e Desvincular só para quem administra', () => {
    const html = desenhar({ dados: { conectado: true, vinculo: vinculo(), erroDaLeitura: null } });
    expect(html).toContain('Rescindido');
    expect(html).toContain('desde ');
    expect(html).toContain('Ligado sozinho pela leitura, pelo link da conversa');
    expect(html).toMatch(/<a[^>]*href="https:\/\/app\.example\.com\/#\/clients\/[^"]+"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain('Situação lida em');
    expect(html).not.toContain('Desvincular');
    semChaveCrua(html);
    h.podeVincular = true;
    expect(desenhar({ dados: { conectado: true, vinculo: vinculo(), erroDaLeitura: null } })).toContain('Desvincular');
  });

  it('leitura velha: o aviso de atraso; nunca lida: diz que ainda não leu', () => {
    expect(desenhar({ dados: { conectado: true, vinculo: vinculo({ velha: true }), erroDaLeitura: 'fora_do_ar' } })).toContain('a leitura do Atlas está atrasada');
    expect(desenhar({ dados: { conectado: true, vinculo: vinculo({ velha: true, lidaEm: null }), erroDaLeitura: null } })).toContain('A situação ainda não foi lida do Atlas.');
  });

  it('situação desconhecida: o texto de reserva (nunca a chave crua); data desconhecida dita', () => {
    const html = desenhar({ dados: { conectado: true, vinculo: vinculo({ situacao: 'arquivado', situacaoDesde: null, origem: 'coisa', casouPor: null }), erroDaLeitura: null } });
    expect(html).toContain('Outra situação (arquivado)');
    expect(html).toContain('data da mudança desconhecida');
    expect(html).toContain('Vínculo de origem desconhecida');
    semChaveCrua(html);
  });

  it('em_negociacao lê como Ativo', () => {
    expect(desenhar({ dados: { conectado: true, vinculo: vinculo({ situacao: 'em_negociacao' }), erroDaLeitura: null } })).toContain('>Ativo<');
  });

  it('na LIXEIRA do Atlas: diz, com o link (o Atlas mostra o Restaurar) — sem afirmar a situação', () => {
    h.podeVincular = true;
    const html = desenhar({ dados: { conectado: true, vinculo: vinculo({ excluidoEm: '2026-09-29T10:00:00.000Z' }), erroDaLeitura: null } });
    expect(html).toContain('está na lixeira do Atlas');
    expect(html).toContain('Abrir no Atlas');
    expect(html).toContain('Desvincular');
    expect(html).not.toContain('Rescindido');
  });

  it('⚠️ na LIXEIRA: o admin tem "Conferir no Atlas" (restaurar lá não muda a data, e só a listagem completa tiraria a marca)', () => {
    const naLixeira = { conectado: true, vinculo: vinculo({ excluidoEm: '2026-09-29T10:00:00.000Z' }), erroDaLeitura: null };
    h.podeVincular = true;
    const admin = desenhar({ dados: naLixeira });
    expect(admin).toContain('Conferir no Atlas');
    expect(admin).toContain('toque em “Conferir no Atlas”');
    semChaveCrua(admin);
    expect(desenhar({ dados: naLixeira }, en, 'en')).toContain('Check in Atlas');

    // Quem não vincula: sem o botão, e a dica diz quando o CRM percebe (nunca "desvincule").
    h.podeVincular = false;
    const agente = desenhar({ dados: naLixeira });
    expect(agente).not.toContain('Conferir no Atlas');
    expect(agente).not.toContain('Desvincular');
    expect(agente).toContain('próxima leitura completa');
    semChaveCrua(agente);
  });

  it('sem endereço https, sem o botão "Abrir no Atlas"', () => {
    expect(desenhar({ dados: { conectado: true, vinculo: vinculo({ appUrl: null }), erroDaLeitura: null } })).not.toContain('Abrir no Atlas');
  });

  it('en.json: os mesmos estados, sem chave crua', () => {
    h.podeVincular = true;
    const html = desenhar({ dados: { conectado: true, vinculo: vinculo(), erroDaLeitura: null } }, en, 'en');
    expect(html).toContain('Terminated');
    expect(html).toContain('Linked automatically by the sync, by the conversation link');
    expect(html).toContain('Open in Atlas');
    semChaveCrua(html);
    expect(desenhar({ dados: { conectado: true, vinculo: null, erroDaLeitura: null } }, en, 'en')).toContain('This contact is not linked to an Atlas client.');
  });
});
