import { describe, expect, it } from 'vitest';

import { gravarDesfechoDoLote, type BroadcastApiResult } from './use-broadcast-sending';

// ============================================================
// O navegador grava o desfecho do lote SEM passar por cima do que a rota
// já anotou, do que o recibo da Meta já avançou — nem do que PODE ter saído.
//
// Desde que a rota `api/whatsapp/broadcast` grava o wamid na hora em que a
// Meta aceita o envio (`anotado`), a linha pode chegar ao navegador já
// `sent` — e até `delivered`, se o recibo veio antes de o lote inteiro
// voltar. Regravar `sent` a rebaixaria.
//
// ⚠️⚠️ 1151: a rota RESERVA cada linha antes da Meta (`pending` →
// `uncertain`). O lote cuja chamada cai sem recusa comprovada não grava NADA
// daqui: o `failed` de antes levava o "Tentar de novo os que falharam" a
// mandar o modelo pago em dobro a quem já tinha recebido.
// ============================================================

type Linha = { id: string; status: string; whatsapp_message_id?: string | null };

/** `broadcast_recipients` em memória, com o que o hook usa. */
function bancoFalso(linhas: Linha[], opcoes: { rlsBarra?: boolean; leituraFalha?: boolean } = {}) {
  const tabela = new Map(linhas.map((l) => [l.id, { ...l }]));
  const escritas: { id: string; patch: Record<string, unknown> }[] = [];
  /** Todo UPDATE pedido, tenha ou não casado linha. */
  const tentativas: { patch: Record<string, unknown>; origens: unknown[] }[] = [];
  const db = {
    from(nome: string) {
      expect(nome).toBe('broadcast_recipients');
      return {
        update(patch: Record<string, unknown>) {
          const filtros: [string, (v: unknown) => boolean][] = [];
          const tentativa = { patch, origens: [] as unknown[] };
          tentativas.push(tentativa);
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, (v) => v === val]);
              return q;
            },
            in(col: string, vals: unknown[]) {
              if (col === 'status') tentativa.origens = vals;
              filtros.push([col, (v) => vals.includes(v)]);
              return q;
            },
            async select() {
              if (opcoes.rlsBarra) return { data: [], error: null };
              const tocadas = [...tabela.values()].filter((l) =>
                filtros.every(([c, casa]) => casa((l as Record<string, unknown>)[c])),
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

const resultado = (
  id: string,
  status: BroadcastApiResult['status'],
  extra: Partial<BroadcastApiResult> = {},
): BroadcastApiResult => ({ phone: linha(id).contact.phone!, status, recipient_id: id, ...extra });

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

  it('⚠️ a rota reservou e não anotou: o `sent` com wamid vale sobre a reserva (o wamid é a prova)', async () => {
    const { db, tabela, tentativas } = bancoFalso([{ id: '1', status: 'uncertain' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [enviado('1', { anotado: false })],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tentativas[0].origens).toEqual(['pending', 'uncertain']);
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

  it('⚠️⚠️ lote INCERTO (a chamada caiu sem resposta): NADA é gravado daqui', async () => {
    const { db, tabela, tentativas } = bancoFalso([
      { id: '1', status: 'sent', whatsapp_message_id: 'wamid.1' },
      { id: '2', status: 'uncertain' },
      { id: '3', status: 'pending' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2'), linha('3')], {
      incerto: 'Failed to fetch',
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tentativas).toEqual([]);
    // A reservada segue incerta (pode ter saído: fora do "Tentar de novo");
    // a não reservada segue pendente (não saiu: o Retomar a manda).
    expect(tabela.get('1')!.status).toBe('sent');
    expect(tabela.get('2')!.status).toBe('uncertain');
    expect(tabela.get('3')!.status).toBe('pending');
  });

  it('lote RECUSADO (4xx: a rota parou antes de mandar): as pendentes viram falha, o resto fica', async () => {
    const { db, tabela } = bancoFalso([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
      { id: '3', status: 'uncertain' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2'), linha('3')], {
      recusa: 'Unauthorized',
    });
    expect(r).toEqual({ falhas: 2, escritasPerdidas: 0 });
    expect(tabela.get('1')).toMatchObject({ status: 'failed', error_message: 'Unauthorized' });
    expect(tabela.get('2')).toMatchObject({ status: 'failed', error_message: 'Unauthorized' });
    expect(tabela.get('3')!.status).toBe('uncertain');
  });

  it('⚠️ `uncertain` e `skipped` da rota: nada a gravar, e não contam como falha', async () => {
    const { db, tabela, tentativas } = bancoFalso([
      { id: '1', status: 'uncertain' },
      { id: '2', status: 'sent', whatsapp_message_id: 'wamid.outro' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2')], {
      resultados: [
        resultado('1', 'uncertain', { error: 'Meta API error: 500', anotado: true }),
        resultado('2', 'skipped'),
      ],
    });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tentativas).toEqual([]);
    expect(tabela.get('1')!.status).toBe('uncertain');
    expect(tabela.get('2')!.status).toBe('sent');
  });

  it('a recusa que a ROTA já gravou conta como falha sem regravar', async () => {
    const { db, tentativas } = bancoFalso([{ id: '1', status: 'failed' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [resultado('1', 'failed', { error: 'recusado', anotado: true })],
    });
    expect(r).toEqual({ falhas: 1, escritasPerdidas: 0 });
    expect(tentativas).toEqual([]);
  });

  it('⚠️ a falha que a rota NÃO gravou só vai sobre `pending` — nunca por cima da incerta', async () => {
    const { db, tabela, tentativas } = bancoFalso([{ id: '1', status: 'uncertain' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], {
      resultados: [resultado('1', 'failed', { error: 'recusado', anotado: false })],
    });
    expect(tentativas[0].origens).toEqual(['pending']);
    expect(tabela.get('1')!.status).toBe('uncertain');
    // Já saiu de `pending` por outra mão: nem falha, nem escrita perdida.
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
  });

  it('linha com telefone que a rota não citou: nada (a reserva diz a verdade)', async () => {
    const { db, tabela, tentativas } = bancoFalso([{ id: '1', status: 'pending' }]);
    const r = await gravarDesfechoDoLote(db, [linha('1')], { resultados: [] });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 0 });
    expect(tentativas).toEqual([]);
    expect(tabela.get('1')!.status).toBe('pending');
  });

  it('falha da Meta e linha sem telefone viram failed', async () => {
    const { db, tabela } = bancoFalso([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
    ]);
    const r = await gravarDesfechoDoLote(db, [linha('1'), linha('2', null)], {
      resultados: [resultado('1', 'failed', { error: 'recusado' })],
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
      resultados: [enviado('1'), resultado('2', 'failed', { error: 'x' })],
    });
    expect(r).toEqual({ falhas: 1, escritasPerdidas: 2 });
  });

  it('o `sent` sobre a reserva que não grava é escrita perdida', async () => {
    const { db } = bancoFalso([{ id: '1', status: 'uncertain' }], { rlsBarra: true });
    const r = await gravarDesfechoDoLote(db, [linha('1')], { resultados: [enviado('1')] });
    expect(r).toEqual({ falhas: 0, escritasPerdidas: 1 });
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
    const mesmo = '5583980000016';
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
