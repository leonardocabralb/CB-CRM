import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Notificação do navegador (#516 do original): o cartão e o OUVINTE andam
// juntos, e o ouvinte é o NOSSO.
//
// O merge #259 (23/09/2026) montou o cartão em Seu perfil e deixou o ouvinte
// sem montar: a pessoa ligava a chave, recebia a notificação de teste e
// nunca a de uma mensagem real. A Fase 8 do plano do merge do upstream
// montou o ouvinte na casca, DENTRO da <PortaDeEntrada>, com a régua do
// operador (P2): só as conexões do perfil, grupo fora, configurável.
//
// Um merge que traga a versão crua do original devolve, sem conflito:
// o aviso de GRUPO e de conexão fora do perfil (o hook dele avisa toda
// mensagem de cliente), a preferência GLOBAL do navegador (quem entra depois
// herda o "ligado") e o ouvinte montado antes do "Continuar".
// ============================================================

const SRC = path.join(__dirname, '../..');
const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** O fonte sem comentários: uma nota que cite a forma proibida não conta. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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
    return /<BrowserNotificationsCard\b/.test(fs.readFileSync(p, 'utf8'));
  });
  const shell = semComentarios(ler('app/(dashboard)/dashboard-shell.tsx'));

  it('o ouvinte é montado UMA vez, na casca, e só depois do "Continuar"', () => {
    const montagens = shell.match(/<BrowserNotificationsListener\b/g) ?? [];
    expect(montagens).toHaveLength(1);
    // Antes do "Continuar" a porta segura a página e a presença; o aviso é o
    // mesmo tipo de efeito (e o clique navegaria por trás do resumo).
    expect(shell).toMatch(/\{!entradaPendente && <BrowserNotificationsListener \/>\}/);
    const fora = arquivos(SRC).filter(
      (p) =>
        !p.endsWith('dashboard-shell.tsx') &&
        /<BrowserNotificationsListener\b/.test(semComentarios(fs.readFileSync(p, 'utf8'))),
    );
    expect(fora).toEqual([]);
  });

  it('o cartão está em Seu perfil, e só em Seu perfil', () => {
    expect(quemMontaOCartao.map((p) => path.relative(SRC, p))).toEqual([
      'components/settings/profile-form.tsx',
    ]);
  });

  it('o ouvinte usa a NOSSA régua e o contexto REAL', () => {
    const hook = semComentarios(ler('hooks/use-browser-notifications.ts'));
    // A régua do operador (perfil, grupo, "quais", mensagem antiga)... — e o
    // silêncio dela CALA o aviso: chamar a régua e ignorar a resposta passaria
    // numa conferência que só procurasse a chamada (medido por mutante).
    expect(hook).toMatch(/const silencio = silencioDoAviso\(/);
    expect(hook).toMatch(/if \(silencio\) return;\s*\n\s*const labels = labelsRef\.current;/);
    // ...o nome pela régua da casa (telefone, senão @instagram)...
    expect(hook).toMatch(/nomeDoContato\(/);
    expect(hook).not.toMatch(/pickContactDisplayName\(/);
    // ...a preferência POR PESSOA, nunca a global do original...
    expect(hook).not.toMatch(/readBrowserNotifyPref|BROWSER_NOTIFY_STORAGE_KEY/);
    // ...e o contexto REAL: `acesso` do useAuth carrega a lente do "Ver como".
    expect(hook).not.toMatch(/\bacesso\b/);
    expect(hook).toMatch(/papel: profile\?\.account_role/);
  });

  it('lê o pino do canal e espera a atribuição antes de ler o responsável', () => {
    // Codex, PR #287: sem `channel_pinned` a régua não sabe se a conversa
    // segue o cliente; sem a espera, "só as minhas" perde a mensagem que a
    // automação atribui logo depois do INSERT.
    const hook = semComentarios(ler('hooks/use-browser-notifications.ts'));
    expect(hook).toMatch(/"id, channel_id, channel_pinned, group_id, assigned_agent_id, "/);
    expect(hook).toMatch(
      /if \(dependeDoResponsavel\(vivoRef\.current\.preferencia\.quais\)\) \{\s*await new Promise\(\(r\) => setTimeout\(r, ESPERA_PELA_ATRIBUICAO_MS\)\);\s*if \(cancelado\) return;\s*\}\s*const \{ data, error \} = await supabase/,
    );
  });

  it('o clique abre a conversa também com o inbox já montado', () => {
    // Só o `router.push` troca a query e a página não remonta: a URL dizia
    // uma conversa e o fio mostrava outra (revisão da Fase 8, P2).
    const hook = semComentarios(ler('hooks/use-browser-notifications.ts'));
    expect(hook).toMatch(
      /window\.dispatchEvent\(\s*new CustomEvent\(EVENTO_ABRIR_CONVERSA, \{ detail: msg\.conversation_id \}\)/,
    );
    const inbox = semComentarios(ler('app/(dashboard)/inbox/page.tsx'));
    expect(inbox).toMatch(/window\.addEventListener\(EVENTO_ABRIR_CONVERSA, /);
    // ...sem reabrir a que já está ativa (zeraria o fio carregado).
    expect(inbox).toMatch(/if \(conversaAbertaRef\.current === id\) return;\s*conversaRecemAbertaRef\.current = id;/);
  });

  it('aparelho de toque não liga o aviso (sem service worker o construtor lança)', () => {
    const hook = semComentarios(ler('hooks/use-browser-notifications.ts'));
    expect(hook).toMatch(/if \(!avisoPossivelNoAparelho\(\)\) return;/);
    expect(hook).toMatch(/matchMedia\?\.\(MIDIA_DE_TOQUE\)\.matches/);
    const cartao = semComentarios(ler('components/settings/browser-notifications-card.tsx'));
    expect(cartao).toMatch(/const supported = permission !== 'unsupported' && !toque;/);
  });
});
