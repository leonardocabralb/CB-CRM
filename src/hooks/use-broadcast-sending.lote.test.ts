import { describe, expect, it } from 'vitest';

import { gravarDesfechoDoLote, type BroadcastApiResult } from './use-broadcast-sending';

// ============================================================
// O navegador grava o desfecho do lote SEM passar por cima do que a rota
// já anotou nem do que o recibo da Meta já avançou.
//
// Desde que a rota `api/whatsapp/broadcast` grava o wamid na hora em que a
// Meta aceita o envio (`anotado`), a linha pode chegar ao navegador já
// `sent` — e até `delivered`, se o recibo veio antes de o lote inteiro
// voltar. Regravar `sent` a rebaixaria; o `failed` de um lote que caiu no
// meio apagaria envios que aconteceram.
// ============================================================

type Linha = { id: string; status: string; whatsapp_message_id?: string | null };

/** `broadcast_recipients` em memória, com o que o hook usa. */
function bancoFalso(linhas: Linha[], opcoes: { rlsBarra?: boolean; leituraFalha?: boolean } = {}) {
  const tabela = new Map(linhas.map((l) => [l.id, { ...l }]));
  const escritas: { id: string; patch: Record<string, unknown> }[] = [];
  /** Todo UPDATE pedido, tenha ou não casado linha. */
  const tentativas: Record<string, unknown>[] = [];
  const db = {
    from(nome: string) {
      expect(nome).toBe('broadcast_recipients');
      return {
        update(patch: Record<string, unknown>) {
          tentativas.push(patch);
          const filtros: [string, unknown][] = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            async select() {
              if (opcoes.rlsBarra) return { data: [], error: null };
              const tocadas = [...tabela.values()].filter((l) =>
                filtros.every(([c, v]) => (l as Record<string, unknown>)[c] === v),
              );
              for (const l of tocadas) {
                Object.assign(l, patch);
                escritas.push({ id: l.id, patch });
              }
              return { data: tocadas.map((l) => ({ id: l.id })), error: null };
            },
          };
          return q;
        },
        select() {
          return {
            async in(_col: string, ids: string[]) {
              if (opcoes.leituraFalha) return { data: null, error: { message: 'falhou' } };
              return {
                data: ids
                  .filter((id) => tabela.has(id))
                  .map((id) => ({ id, status: tabela.get(id)!.status })),
                error: null,
              };
            },
          };
        },
      };
    },
  };
  return { db: db as never, tabela, escritas, tentativas };
}

const linha = (id: string, phone: string | null = `55839${id.padStart(8, '0')}`) => ({
  id,
  contact: { phone },
});

const enviado = (id: string, extra: Partial<BroadcastApiResult> = {}): BroadcastApiResult => ({
  phone: `55839${id.padStart(8, '0')}`,
  status: 'sent',
  whatsapp_message_id: `wamid.${id}`,
  recipient_id: id,
  ...extra,
});

describe('gravarDesfechoDoLote', () => {
  it('linha que a rota anotou não é regravada — nem quando o recibo já a levou a entregue', async () => {
    const { db, tabela, escritas, tentativas } = bancoFalso([{ id: '1', status: 'delivered', whatsapp_message_id: 'wamid.1' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [enviado('1', { anotado: true })],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    // Nem tenta: a linha é da rota.
    expect(tentativas).toEqual([]);
    expect(escritas).toEqual([]);
    expect(tabela.get('1')!.status).toBe('delivered');
  });

  it('a rota não anotou: o navegador grava como antes', async () => {
    const { db, tabela } = bancoFalso([{ id: '1', status: 'pending' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [enviado('1', { anotado: false })],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tabela.get('1')).toMatchObject({ status: 'sent', whatsapp_message_id: 'wamid.1' });
  });

  it('⚠️ a resposta disse "não anotei", mas a linha já andou: não rebaixa, e não é escrita perdida', async () => {
    // A rota gravou e perdeu a resposta do banco; o recibo veio em seguida.
    const { db, tabela } = bancoFalso([{ id: '1', status: 'delivered', whatsapp_message_id: 'wamid.1' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [enviado('1', { anotado: false })],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tabela.get('1')!.status).toBe('delivered');
  });

  it('⚠️ o lote caiu no meio: o que a rota anotou fica, o resto vira falha', async () => {
    const { db, tabela } = bancoFalso([
      { id: '1', status: 'sent', whatsapp_message_id: 'wamid.1' },
      { id: '2', status: 'delivered', whatsapp_message_id: 'wamid.2' },
      { id: '3', status: 'pending' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2'), linha('3')], {
      erro: 'Failed to fetch',
    });
    expect(r).toEqual({ falhas: 1, escritasPerdidas: 0 });
    expect(tabela.get('1')!.status).toBe('sent');
    expect(tabela.get('2')!.status).toBe('delivered');
    expect(tabela.get('3')).toMatchObject({ status: 'failed', error_message: 'Failed to fetch' });
  });

  it('falha da Meta e linha sem telefone viram failed', async () => {
    const { db, tabela } = bancoFalso([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2', null)], {
      resultados: [{ phone: linha('1').contact.phone!, status: 'failed', error: 'recusado', recipient_id: '1' }],
    });
    expect(r).toEqual({ falhas: 2, escritasPerdidas: 0 });
    expect(tabela.get('1')).toMatchObject({ status: 'failed', error_message: 'recusado' });
    expect(tabela.get('2')).toMatchObject({ status: 'failed', error_message: 'No phone number on contact' });
  });

  it('a RLS barrando continua sendo escrita perdida (e a falha continua falha)', async () => {
    const { db } = bancoFalso(
      [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
      ],
      { rlsBarra: true },
    );
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2')], {
      resultados: [
        enviado('1'),
        { phone: linha('2').contact.phone!, status: 'failed', error: 'x', recipient_id: '2' },
      ],
    });
    expect(r).toEqual({ falhas: 1, escritasPerdidas: 2 });
  });

  it('a conferência que falha conta como escrita perdida, como antes', async () => {
    const { db } = bancoFalso([{ id: '1', status: 'pending' }], { rlsBarra: true, leituraFalha: true });
    const r = await gravarDesfechoDoLote(db, [linha('1')], { resultados: [enviado('1')] });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 1 });
  });

  it('casa pela LINHA quando dois destinatários têm o mesmo telefone', async () => {
    const { db, tabela } = bancoFalso([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
    ]);
    const mesmo = '5583988745316';
    const r = await gravarDesfechoDoLote(db, [linha('1', mesmo), linha('2', mesmo)], {
      resultados: [
        { phone: mesmo, status: 'sent', whatsapp_message_id: 'wamid.1', recipient_id: '1' },
        { phone: mesmo, status: 'failed', error: 'x', recipient_id: '2' },
      ],
    });
    expect(r).toEqual({ falhas: 1, escritasPerdidas: 0 });
    expect(tabela.get('1')).toMatchObject({ status: 'sent', whatsapp_message_id: 'wamid.1' });
    expect(tabela.get('2')!.status).toBe('failed');
  });

  it('servidor antigo (sem recipient_id no resultado): casa pelo telefone', async () => {
    const { db, tabela } = bancoFalso([{ id: '1', status: 'pending' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [{ phone: linha('1').contact.phone!, status: 'sent', whatsapp_message_id: 'wamid.1' }],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tabela.get('1')).toMatchObject({ status: 'sent', whatsapp_message_id: 'wamid.1' });
  });
});
