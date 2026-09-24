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
 */
export async function lerComTeto(r: Response, teto: number): Promise<Buffer> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > teto) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`Media download refused: ${declarado} bytes over the ${teto}-byte limit`);
  }
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => {});
      throw new Error(`Media download refused: over the ${teto}-byte limit`);
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}
