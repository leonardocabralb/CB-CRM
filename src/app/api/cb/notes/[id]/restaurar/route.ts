import { mudarNaLixeira } from '@/lib/notes/lixeira-no-servidor';

/**
 * RESTAURAR uma anotação da lixeira (1132): tira a marca de apagada. Ela volta
 * com o MESMO id, no lugar em que foi escrita, com anexos, menções e
 * respostas. Não refixa (a fixada do cliente pode ser outra agora). Quem pode:
 * o autor ou admin/dono (decisão do operador, 10/11/2026). A mecânica, as
 * guardas e os códigos de resposta: `mudarNaLixeira`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return mudarNaLixeira(id, 'restaurar');
}
