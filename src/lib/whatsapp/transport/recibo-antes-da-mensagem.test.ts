import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAUSAS_DO_RECIBO_MS,
  aplicarReciboQuandoAMensagemExistir,
  type Tentativa,
} from './recibo-antes-da-mensagem';

/**
 * Banco de mentira com relógio próprio: a linha da mensagem nasce `nasceEm`
 * ms depois do recibo (`null` = nunca nasce) e pode já estar entregue.
 */
function banco(nasceEm: number | null, jaEntregue = false) {
  let agora = 0;
  let status: 'sent' | 'delivered' = jaEntregue ? 'delivered' : 'sent';
  const conta = { tentativas: 0, leituras: 0, esperas: [] as number[] };
  const existe = () => nasceEm !== null && agora >= nasceEm;
  const rodar = (pausas: readonly number[] = PAUSAS_DO_RECIBO_MS) =>
    aplicarReciboQuandoAMensagemExistir({
      tentar: async (): Promise<Tentativa> => {
        conta.tentativas++;
        // O UPDATE da rota: um DELIVERY_ACK só avança quem ainda está em `sent`.
        if (!existe() || status !== 'sent') return 'nada';
        status = 'delivered';
        return 'avancou';
      },
      existe: async () => {
        conta.leituras++;
        return existe();
      },
      esperar: async (ms) => {
        conta.esperas.push(ms);
        agora += ms;
      },
      pausas,
    });
  return { conta, rodar, status: () => status };
}

describe('recibo que chega antes da mensagem', () => {
  it('a linha já existe: avança na primeira tentativa, sem ler nem esperar', async () => {
    const b = banco(0);
    expect(await b.rodar()).toBe(true);
    expect(b.conta).toEqual({ tentativas: 1, leituras: 0, esperas: [] });
  });

  it('⚠️ o caso medido em 10/09/2026: a mensagem nasce 1,9 s depois do recibo, e ele ainda vale', async () => {
    // PATCH do recibo às 12:51:55.708, POST da mensagem às 12:51:57.644.
    // Sem a espera, o recibo morria aqui e a bolha ficava num ✓.
    const b = banco(1_936);
    expect(await b.rodar()).toBe(true);
    expect(b.status()).toBe('delivered');
    expect(b.conta.esperas).toEqual([1_000, 2_000]);
  });

  it('recibo atrasado ou repetido (a linha já passou do degrau): desiste sem esperar', async () => {
    const b = banco(0, true);
    expect(await b.rodar()).toBe(false);
    // A leitura acha a linha: UMA tentativa extra, nenhuma espera.
    expect(b.conta).toEqual({ tentativas: 2, leituras: 1, esperas: [] });
  });

  it('a linha nasce ENTRE o UPDATE e a leitura: a tentativa extra aplica o recibo', async () => {
    let nasceu = false;
    const avancou = await aplicarReciboQuandoAMensagemExistir({
      tentar: async () => (nasceu ? 'avancou' : 'nada'),
      existe: async () => {
        nasceu = true; // o INSERT caiu exatamente aqui
        return true;
      },
      esperar: async () => {},
      pausas: PAUSAS_DO_RECIBO_MS,
    });
    expect(avancou).toBe(true);
  });

  it('mensagem que nunca vira linha (ex.: contato só com LID, descartado): desiste no fim das pausas', async () => {
    const b = banco(null);
    expect(await b.rodar()).toBe(false);
    expect(b.conta.tentativas).toBe(PAUSAS_DO_RECIBO_MS.length + 1);
    expect(b.conta.esperas).toEqual([...PAUSAS_DO_RECIBO_MS]);
  });

  it('erro no UPDATE: desiste na hora, sem ler nem esperar', async () => {
    let leituras = 0;
    const avancou = await aplicarReciboQuandoAMensagemExistir({
      tentar: async () => 'erro',
      existe: async () => {
        leituras++;
        return false;
      },
      esperar: async () => {},
      pausas: PAUSAS_DO_RECIBO_MS,
    });
    expect(avancou).toBe(false);
    expect(leituras).toBe(0);
  });

  it('sem pausas (recibo de mensagem RECEBIDA): uma tentativa só, como era antes', async () => {
    const b = banco(null);
    expect(await b.rodar([])).toBe(false);
    expect(b.conta).toEqual({ tentativas: 1, leituras: 0, esperas: [] });
  });

  it('a espera resolve rápido o caso comum e tem fim', () => {
    // A 1ª pausa curta resolve o caso medido em ~3 s; o total fica muito
    // acima dos ~2 s de gravação e, ainda assim, termina.
    expect(PAUSAS_DO_RECIBO_MS[0]).toBeLessThanOrEqual(2_000);
    const total = PAUSAS_DO_RECIBO_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(15_000);
    expect(total).toBeLessThanOrEqual(60_000);
  });
});

describe('a rota do webhook da Evolution usa a espera', () => {
  const raiz = path.join(__dirname, '..', '..', '..');
  /** Fonte sem comentários — a rota cita o helper ao EXPLICAR a decisão. */
  const fonte = fs
    .readFileSync(path.join(raiz, 'app/api/whatsapp/evolution/webhook/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('o recibo passa por aplicarReciboQuandoAMensagemExistir, não por um UPDATE solto', () => {
    // Um merge que devolva o UPDATE de uma tentativa só perde o recibo em
    // silêncio — nada estoura, a bolha só fica num ✓.
    expect(fonte).toContain('aplicarReciboQuandoAMensagemExistir(');
    expect(fonte).toContain('PAUSAS_DO_RECIBO_MS');
  });

  it('recibo de mensagem recebida (fromMe false) não espera', () => {
    expect(fonte).toMatch(/d\.fromMe === false \? \[\] : PAUSAS_DO_RECIBO_MS/);
  });
});
