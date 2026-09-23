import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O cartão "Notificações do navegador" (#516 do original) só aparece com o
// OUVINTE montado.
//
// O merge #259 (23/09/2026) montou o cartão em Seu perfil e deixou o
// ouvinte sem montar: a pessoa ligava a chave, o navegador pedia permissão,
// a notificação de teste chegava — e nenhuma mensagem real avisava nada. A
// correção do #259 tirou o cartão até a Fase 8 do plano do merge do
// upstream, que monta o ouvinte DENTRO da <PortaDeEntrada>, com o recorte do
// perfil e grupo de fora. Um porte de tradução (o #578 mexeu no
// profile-form) traria a linha do cartão de volta sem conflito nenhum.
// ============================================================

const SRC = path.join(__dirname, '../..');

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) saida.push(p);
  }
  return saida;
}

describe('cartão de notificação do navegador × ouvinte', () => {
  const quemMontaOCartao = arquivos(SRC).filter((p) => {
    if (p.endsWith('browser-notifications-card.tsx')) return false;
    return /\bBrowserNotificationsCard\b/.test(fs.readFileSync(p, 'utf8'));
  });
  const shell = fs.readFileSync(path.join(SRC, 'app/(dashboard)/dashboard-shell.tsx'), 'utf8');
  const ouvinteMontado = /<BrowserNotificationsListener\b/.test(shell);

  it('o cartão só é usado se o ouvinte estiver montado na casca', () => {
    if (quemMontaOCartao.length > 0) {
      expect(
        ouvinteMontado,
        `o cartão aparece em ${quemMontaOCartao.map((p) => path.relative(SRC, p)).join(', ')} sem o ouvinte montado no dashboard-shell`,
      ).toBe(true);
    }
  });

  it('hoje (até a Fase 8) nenhum dos dois está montado', () => {
    // Quando a Fase 8 montar o ouvinte, este caso é o que muda — e junto a
    // nota da tabela de divergências do CLAUDE.md (profile-form.tsx).
    expect(quemMontaOCartao).toEqual([]);
    expect(ouvinteMontado).toBe(false);
  });
});
