/**
 * O corpo inteiro de uma resposta, recusando o que passa de `teto` DURANTE a
 * leitura — para todo download de URL que vem de fora.
 *
 * `arrayBuffer()` lê tudo para a memória e só depois deixa conferir o
 * tamanho: com a URL escolhida por outra pessoa, um corpo de gigabytes
 * derruba o processo Node, que é de todas as contas. `content-length` acima
 * do teto recusa sem ler; sem ele (ou mentindo), a contagem para a leitura no
 * primeiro byte a mais.
 *
 * Nasceu no download da mídia do Instagram (Fase 1b do merge do upstream) e
 * mudou para cá quando o cabeçalho de modelo (Fase 6a) precisou dele.
 *
 * O teto estourado lança {@link TetoExcedido}; o resto (tempo esgotado,
 * conexão que cai no meio) sai como veio. Quem traduz o erro para a tela
 * separa os dois: dizer "grande demais" sobre um download lento manda a
 * pessoa encolher um arquivo que não é grande.
 */
export class TetoExcedido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'TetoExcedido';
  }
}

export async function lerComTeto(r: Response, teto: number): Promise<Buffer> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > teto) {
    await r.body?.cancel().catch(() => {});
    throw new TetoExcedido(`Media download refused: ${declarado} bytes over the ${teto}-byte limit`);
  }
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  // ⚠️ Com o tamanho declarado, UM buffer, preenchido na chegada: juntar os
  // pedaços no fim (`Buffer.concat`) segura os pedaços E a cópia ao mesmo
  // tempo — ~200 MB de pico para o documento de 100 MB (revisão do PR #284).
  // O que passar do declarado vai para `resto` e é juntado no fim: o
  // `content-length` de resposta comprimida conta os bytes comprimidos, e o
  // fetch entrega o corpo descomprimido. Sem o declarado, é só `resto`.
  const inicio = Number.isInteger(declarado) && declarado > 0 ? Buffer.alloc(declarado) : null;
  let noInicio = 0;
  const resto: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => {});
      throw new TetoExcedido(`Media download refused: over the ${teto}-byte limit`);
    }
    if (inicio && resto.length === 0 && noInicio + value.byteLength <= inicio.byteLength) {
      inicio.set(value, noInicio);
      noInicio += value.byteLength;
    } else {
      resto.push(value);
    }
  }
  if (!inicio) return Buffer.concat(resto);
  if (resto.length === 0) return inicio.subarray(0, noInicio);
  return Buffer.concat([inicio.subarray(0, noInicio), ...resto]);
}
