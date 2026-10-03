import { describe, expect, it } from 'vitest';

import { exemplosDoGatilho, NOMES_DO_EVENTO } from './exemplos';

// ============================================================
// Os exemplos das `{{vars.*}}` saem das funções REAIS (condição do operador:
// sem manutenção). Aqui se confere que cada família entrega todas as
// variáveis preenchidas — um exemplo em branco não mostra o formato a ninguém
// — e que o nome do cliente escolhido na prévia entra no lugar do fictício.
// ============================================================

// 29/09/2026 13:00 em Brasília.
const AGORA = new Date('2026-09-29T16:00:00Z');

describe('exemplosDoGatilho', () => {
  it('cobrança vencida: toda variável da régua preenchida, com a parcela e o link', () => {
    const v = exemplosDoGatilho('asaas_cobranca_vencida', { agora: AGORA, escritorio: 'Escritório Modelo' })!;
    for (const nome of NOMES_DO_EVENTO.asaas) expect(v[nome], nome).not.toBe('');
    expect(v.cliente_primeiro_nome).toBe('Maria');
    expect(v.escritorio_nome).toBe('Escritório Modelo');
    expect(v.dias_de_atraso).toBe('5');
    expect(v.cobranca_detalhe).toContain('https://www.asaas.com/i/exemplo');
    expect(v.vencimento_texto).toBe('vence hoje');
  });

  it('lembrete do dia: o detalhe é só a parcela de hoje', () => {
    const v = exemplosDoGatilho('asaas_cobranca_vence_hoje', { agora: AGORA })!;
    expect(v.cobranca_quantidade).toBe('1');
    expect(v.cobranca_detalhe).toContain('vence hoje');
    expect(v.vencimento_texto).toBe('vence hoje');
  });

  it('agendamento: amanhã às 14h, no fuso do escritório', () => {
    const v = exemplosDoGatilho('calendly_booking', { agora: AGORA })!;
    expect(v.agendamento_data).toBe('30/09/2026 às 14:00h');
    expect(v.agendamento_situacao).toBe('Novo agendamento');
    expect(v.agendamento_link).toMatch(/^https:\/\//);
  });

  it('assinatura: sem CPF e sem respostas inventadas', () => {
    const v = exemplosDoGatilho('zapsign_documento_assinado', { agora: AGORA })!;
    expect(Object.keys(v).sort()).toEqual([...NOMES_DO_EVENTO.zapsign].sort());
    expect(v.zapsign_assinado_em).toBe('29/09/2026 às 13:00h');
  });

  it('mudança de situação do Atlas: situação, data e link, sem dado pessoal', () => {
    const v = exemplosDoGatilho('atlas_situacao_mudou', { agora: AGORA, nome: 'Ana Lima' })!;
    expect(Object.keys(v).sort()).toEqual([...NOMES_DO_EVENTO.atlas].sort());
    for (const nome of NOMES_DO_EVENTO.atlas) expect(v[nome], nome).not.toBe('');
    expect(v.atlas_situacao_em).toBe('29/09/2026 às 13:00h');
    expect(JSON.stringify(v)).not.toContain('Ana Lima');
  });

  it('o nome do cliente da prévia entra no lugar do fictício', () => {
    expect(exemplosDoGatilho('asaas_cobranca_vencida', { agora: AGORA, nome: 'leonardo cabral' })!.cliente_primeiro_nome).toBe(
      'Leonardo',
    );
    expect(exemplosDoGatilho('calendly_booking', { agora: AGORA, nome: 'Ana Lima' })!.agendamento_nome).toBe('Ana Lima');
    expect(exemplosDoGatilho('zapsign_documento_assinado', { agora: AGORA, nome: '  ' })!.zapsign_signatario_nome).toBe(
      'Maria Souza',
    );
  });

  it('gatilho sem variáveis de evento não tem exemplo', () => {
    expect(exemplosDoGatilho('deal_stage_changed', { agora: AGORA })).toBeNull();
    expect(exemplosDoGatilho('webhook_received', { agora: AGORA })).toBeNull();
  });
});
