import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { summarizeScope } from '@/lib/cb-channels/display';
import type { CbChannel } from '@/lib/cb-channels/repo';

// ============================================================
// M18 — recorte de canal que fica PRESO no perfil.
//
// A grade de checkbox própria do painel desenhava `channels.map(...)` — só
// os canais VIVOS. Id de conexão apagada não ganhava caixinha, e como o
// array só mudava por essas caixinhas, o id ficava lá para sempre.
//
// O encadeamento é o que faz isso doer: escopo NÃO VAZIO significa
// "restrito a estes canais". Se o único id restante aponta para uma conexão
// que não existe, a pessoa não enxerga canal nenhum — e a linha do perfil,
// na mesma tela, dizia "1 conexão", porque contava o tamanho do array.
// A tela afirmava acesso e entregava zero, sem caminho de conserto que não
// fosse SQL.
// ============================================================

const canais = [
  { id: 'c1', label: 'Comercial' },
  { id: 'c2', label: 'Jurídico' },
] as unknown as CbChannel[];

describe('escopo de canal com id órfão (M18)', () => {
  it('id que não resolve NÃO vira "todos" — seria a mentira oposta', () => {
    // Escopo existe e restringe; dizer "todas as conexões" prometeria o
    // acesso mais amplo possível sobre o mais estreito.
    expect(summarizeScope(canais, ['sumiu']).kind).toBe('unresolved');
  });

  it('escopo com órfão E canal vivo conta só o vivo', () => {
    const r = summarizeScope(canais, ['c1', 'sumiu']);
    expect(r.kind).toBe('one');
    expect(r).toMatchObject({ label: 'Comercial' });
  });

  it('escopo vazio segue sendo TODOS — a convenção da casa', () => {
    expect(summarizeScope(canais, null).kind).toBe('all');
  });
});

// ------------------------------------------------------------
// Pinos de fonte: o comportamento acima só chega à tela se o painel usar o
// componente que tem a saída. Testar isso montando o painel exigiria stub
// de Supabase, de next-intl e do hook de canais — ler o fonte é mais
// honesto sobre o que está sendo garantido.
// ------------------------------------------------------------

const painel = fs
  .readFileSync(
    path.join(__dirname, 'perfis-panel.tsx'),
    'utf8',
  )
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('o painel de perfis oferece a saída (M18)', () => {
  it('usa o ChannelMultiSelect, que tem o item "Todos"', () => {
    expect(painel).toContain('<ChannelMultiSelect');
  });

  it('não voltou a desenhar a grade própria, que não tinha como limpar', () => {
    // A forma exata da regressão: mapear os canais em checkboxes alimentados
    // por `channel_ids`. Um merge que "simplifique" para isso devolve o bug.
    expect(painel).not.toMatch(/channels\.map\([\s\S]{0,200}?Checkbox/);
  });

  it('a LINHA do perfil resume pelo que resolve, não pelo tamanho do array', () => {
    expect(painel).toContain('resumoDeCanais(p.channel_ids)');
    expect(painel).not.toContain("t('someChannels', { count: p.channel_ids.length })");
  });
});
