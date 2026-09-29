import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TIPOS_COM_TEXTO_MONTADO, textoParaOsMotores } from './texto-para-os-motores';

describe('textoParaOsMotores (1060)', () => {
  it('cartão de contato e mensagem de empresa chegam vazios, como antes da 1060', () => {
    expect(textoParaOsMotores('contact', '👤 Joice · +55 85 90000-0013')).toBe('');
    expect(textoParaOsMotores('template', 'Seu boleto foi gerado\n\n[Ver boleto] https://x')).toBe('');
  });

  it('o resto passa como está — texto, legenda, o rótulo do tipo não lido', () => {
    expect(textoParaOsMotores('text', 'oi')).toBe('oi');
    expect(textoParaOsMotores('image', 'foto do contrato')).toBe('foto do contrato');
    expect(textoParaOsMotores('text', null)).toBe('');
    expect(textoParaOsMotores('text', undefined)).toBe('');
  });

  it('os dois são exatamente os tipos cujo texto a ingestão monta', () => {
    expect([...TIPOS_COM_TEXTO_MONTADO].sort()).toEqual(['contact', 'template']);
  });
});

describe('as duas ingestões passam o texto por aqui', () => {
  // Sem comentários: o arquivo explica a regra, e citar o nome na explicação
  // não pode fazer o teste passar.
  const semComentarios = (arquivo: string) =>
    fs
      .readFileSync(path.join(__dirname, '../../..', arquivo), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('Evolution: persistInboundMessage', () => {
    const fonte = semComentarios('src/lib/whatsapp/inbound-store.ts');
    expect(fonte).toMatch(/const inboundText = textoParaOsMotores\(contentType, m\.text\)/);
  });

  it('Meta: o robô e as automações do webhook', () => {
    const fonte = semComentarios('src/app/api/whatsapp/webhook/route.ts');
    expect(fonte).toMatch(/text: textoParaOsMotores\(contentType, contentText \?\? message\.text\?\.body\)/);
    expect(fonte).toMatch(/const inboundText = textoParaOsMotores\(contentType, contentText \?\? message\.text\?\.body\)/);
  });
});
