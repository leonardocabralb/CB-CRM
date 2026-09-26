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

/**
 * O primeiro buffer do corpo com tamanho declarado. Pequeno de propósito: é
 * o que se reserva antes de o servidor provar que está mandando alguma coisa.
 */
export const CAPACIDADE_INICIAL = 64 * 1024;

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
  //
  // ⚠️⚠️ Mas o buffer CRESCE com o que chega (dobrando, a partir de
  // `CAPACIDADE_INICIAL`), e nunca passa do declarado: reservar o declarado
  // de uma vez confiava no cabeçalho de quem está do outro lado — a URL vem
  // de fora —, e um servidor que anuncia perto do teto e manda devagar (ou
  // quase nada) prendia 50 MB por download antes do primeiro byte; vários
  // ao mesmo tempo derrubariam o processo, que é de todas as contas (Codex,
  // PR #299). Assim a reserva fica em no máximo o dobro do que chegou, e com
  // o declarado honesto o último buffer tem o tamanho exato, sem sobra.
  //
  // O que passar do declarado vai para `resto` e é juntado no fim: o
  // `content-length` de resposta comprimida conta os bytes comprimidos, e o
  // fetch entrega o corpo descomprimido. Sem o declarado, é só `resto`.
  let inicio: Buffer | null = Number.isInteger(declarado) && declarado > 0 ? Buffer.alloc(0) : null;
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
    const cabe = noInicio + value.byteLength;
    if (inicio && resto.length === 0 && cabe <= declarado) {
      if (cabe > inicio.byteLength) {
        const maior = Buffer.alloc(
          Math.min(declarado, Math.max(cabe, inicio.byteLength * 2, CAPACIDADE_INICIAL)),
        );
        maior.set(inicio.subarray(0, noInicio));
        inicio = maior;
      }
      inicio.set(value, noInicio);
      noInicio = cabe;
    } else {
      resto.push(value);
    }
  }
  if (!inicio) return Buffer.concat(resto);
  const lido = noInicio === inicio.byteLength ? inicio : inicio.subarray(0, noInicio);
  if (resto.length === 0) return lido;
  return Buffer.concat([lido, ...resto]);
}
