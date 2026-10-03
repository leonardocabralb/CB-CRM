import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
import ptBR from '../../../../messages/pt-BR.json';
import { VARIAVEIS_DO_AGENDAMENTO } from '@/lib/calendly/variaveis';
import { VARIAVEIS_DO_DOCUMENTO } from '@/lib/zapsign/variaveis';
import { VARIAVEIS_DA_MUDANCA } from '@/lib/atlas/gatilho';

import {
  classificarCodigo,
  CODIGOS_DO_CLIENTE,
  familiaDoEvento,
  gatilhoDeMensagem,
  gatilhoTrazCard,
  VARIAVEIS_FIXAS,
} from './catalogo';
import { NOMES_DO_EVENTO } from './exemplos';

// ============================================================
// O catálogo do botão "Inserir campo": a leitura de cada código (espelho de
// `valorDaVariavel`, cruzada com o motor em `engine.test.ts`) e os nomes e
// legendas nos DOIS dicionários — chave montada escapa dos portões de i18n.
// ============================================================

type Arvore = { [k: string]: string | Arvore };
const dicionarios: [string, Arvore][] = [
  ['pt-BR', (ptBR as unknown as { Automations: { variaveis: Arvore } }).Automations.variaveis],
  ['en', (en as unknown as { Automations: { variaveis: Arvore } }).Automations.variaveis],
];

function texto(arvore: Arvore, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((no, k) => (no as Arvore | undefined)?.[k], arvore);
}

describe('classificarCodigo — a régua do motor', () => {
  it('reconhece as variáveis fixas', () => {
    for (const v of VARIAVEIS_FIXAS) {
      expect(classificarCodigo(v.codigo)).toEqual({ tipo: 'fixa', variavel: v });
    }
  });

  it('campo da ficha, variável do evento e o que o motor deixa em branco', () => {
    expect(classificarCodigo('contact.campo.link_reuniao')).toEqual({ tipo: 'campo', chave: 'link_reuniao' });
    expect(classificarCodigo('vars.cobranca_detalhe')).toEqual({ tipo: 'evento', nome: 'cobranca_detalhe' });
    for (const vazio of ['1', 'foo.bar', 'contact.foo', 'deal.title', 'now.x', 'vars', 'channel.nome', 'conversation.id']) {
      expect(classificarCodigo(vazio), vazio).toEqual({ tipo: 'vazio' });
    }
  });

  it('o motor só olha ns.prop: pedaço a mais não muda o que sai', () => {
    expect(classificarCodigo('contact.name.extra')).toMatchObject({ tipo: 'fixa', variavel: { codigo: 'contact.name' } });
    expect(classificarCodigo('vars.a.b')).toEqual({ tipo: 'evento', nome: 'a' });
    expect(classificarCodigo('contact.campo.a.b')).toEqual({ tipo: 'campo', chave: 'a.b' });
  });

  it('a prévia do cliente pede só as fixas que não são do evento', () => {
    expect(CODIGOS_DO_CLIENTE).not.toContain('message.text');
    expect(CODIGOS_DO_CLIENTE).not.toContain('channel.id');
    expect(CODIGOS_DO_CLIENTE).toContain('contact.name');
    expect(CODIGOS_DO_CLIENTE).toContain('deal.value');
  });

  it('famílias de evento e gatilhos de mensagem', () => {
    expect(familiaDoEvento('asaas_cobranca_vencida')).toBe('asaas');
    expect(familiaDoEvento('asaas_cobranca_vence_hoje')).toBe('asaas');
    expect(familiaDoEvento('calendly_booking')).toBe('calendly');
    expect(familiaDoEvento('zapsign_documento_assinado')).toBe('zapsign');
    expect(familiaDoEvento('webhook_received')).toBe('webhook');
    expect(familiaDoEvento('atlas_situacao_mudou')).toBe('atlas');
    expect(familiaDoEvento('deal_stage_changed')).toBeNull();
    expect(gatilhoDeMensagem('keyword_match')).toBe(true);
    // Só a ingestão de mensagem o despacha, com `message_text` no contexto.
    expect(gatilhoDeMensagem('new_contact_created')).toBe(true);
    expect(gatilhoDeMensagem('manual')).toBe(false);
  });

  it('gatilhos cujo EVENTO traz o card (a prévia de {{deal.*}} pode ser de outro card)', () => {
    expect(gatilhoTrazCard('deal_stage_changed')).toBe(true);
    expect(gatilhoTrazCard('deal_status_changed')).toBe(true);
    expect(gatilhoTrazCard('zapsign_documento_assinado')).toBe(true);
    // A mudança de situação do Atlas leva SEMPRE o card do evento (1073).
    expect(gatilhoTrazCard('atlas_situacao_mudou')).toBe(true);
    expect(gatilhoTrazCard('manual')).toBe(false);
    expect(gatilhoTrazCard('calendly_booking')).toBe(false);
  });
});

describe('as variáveis de evento vêm do código que as produz', () => {
  it('o Calendly e o ZapSign produzem exatamente as variáveis que os cartões do gatilho listam', () => {
    expect([...NOMES_DO_EVENTO.calendly].sort()).toEqual([...VARIAVEIS_DO_AGENDAMENTO].sort());
    expect([...NOMES_DO_EVENTO.zapsign].sort()).toEqual([...VARIAVEIS_DO_DOCUMENTO].sort());
    expect([...NOMES_DO_EVENTO.atlas].sort()).toEqual([...VARIAVEIS_DA_MUDANCA].sort());
  });

  it('o Asaas tem as variáveis da régua', () => {
    expect(NOMES_DO_EVENTO.asaas).toContain('cliente_primeiro_nome');
    expect(NOMES_DO_EVENTO.asaas).toContain('cobranca_detalhe');
    expect(NOMES_DO_EVENTO.asaas).toContain('vencimento_texto');
  });
});

describe('nomes e legendas nos dois dicionários (chave montada)', () => {
  for (const [idioma, arvore] of dicionarios) {
    it(`${idioma}: toda variável fixa tem nome e legenda`, () => {
      for (const v of VARIAVEIS_FIXAS) {
        expect(typeof texto(arvore, `fixas.${v.chave}.rotulo`), `${idioma} fixas.${v.chave}.rotulo`).toBe('string');
        expect(typeof texto(arvore, `fixas.${v.chave}.legenda`), `${idioma} fixas.${v.chave}.legenda`).toBe('string');
      }
    });

    it(`${idioma}: toda variável de evento PRODUZIDA pelo código tem nome e legenda`, () => {
      for (const nomes of Object.values(NOMES_DO_EVENTO)) {
        for (const nome of nomes) {
          expect(typeof texto(arvore, `evento.${nome}.rotulo`), `${idioma} evento.${nome}.rotulo`).toBe('string');
          expect(typeof texto(arvore, `evento.${nome}.legenda`), `${idioma} evento.${nome}.legenda`).toBe('string');
        }
      }
    });

    it(`${idioma}: todo grupo tem título`, () => {
      const grupos = [...new Set(VARIAVEIS_FIXAS.map((v) => v.grupo)), 'campos', 'asaas', 'calendly', 'zapsign', 'atlas', 'webhook'];
      for (const g of grupos) {
        expect(typeof texto(arvore, `grupos.${g}`), `${idioma} grupos.${g}`).toBe('string');
      }
    });

    it(`${idioma}: nenhuma entrada órfã em evento`, () => {
      const produzidas = new Set(Object.values(NOMES_DO_EVENTO).flat());
      for (const nome of Object.keys(arvore.evento as Arvore)) {
        expect(produzidas.has(nome), `${idioma} evento.${nome} não é produzida por código nenhum`).toBe(true);
      }
      const fixas = new Set(VARIAVEIS_FIXAS.map((v) => v.chave));
      for (const chave of Object.keys(arvore.fixas as Arvore)) {
        expect(fixas.has(chave), `${idioma} fixas.${chave} sem variável`).toBe(true);
      }
    });
  }
});
