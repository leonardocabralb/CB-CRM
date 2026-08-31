import type { CustomField, GrupoDeCampos } from '@/types';

/**
 * Os BLOCOS de campos personalizados (migration 966).
 *
 * Três telas mostram os mesmos campos repartidos do mesmo jeito — o painel da
 * conversa, a ficha de /contacts e o catálogo de Configurações. A repartição
 * mora aqui porque discordância entre elas é invisível: cada uma pareceria
 * certa sozinha, e só quem olhasse as duas lado a lado veria o campo em blocos
 * diferentes.
 *
 * ⚠️ O BLOCO "GERAL" NÃO TEM LINHA NO BANCO. Ele é o `grupo_id IS NULL`, e por
 * isso `grupo` vem `null` nele. Consequências que o consumidor precisa saber:
 * ele vem SEMPRE primeiro, o rótulo sai do dicionário (não do banco), e ele não
 * é renomeável nem arrastável. Em compensação some sozinho quando todo campo
 * estiver num grupo de verdade.
 */
export interface BlocoDeCampos {
  /** `null` no bloco Geral. */
  grupo: GrupoDeCampos | null;
  campos: CustomField[];
}

/**
 * Ordem entre blocos: posição, e o nome no empate.
 *
 * O desempate não é decoração — `posicao` tem DEFAULT 0 no banco, então grupo
 * criado por qualquer caminho que não seja a tela (uma rota futura, um insert
 * à mão) empata com todos os outros zerados. Sem o nome, a ordem deles ficaria
 * a critério do planejador e mudaria entre duas cargas da mesma tela.
 */
export function ordenarGrupos(grupos: GrupoDeCampos[]): GrupoDeCampos[] {
  return [...grupos].sort(
    (a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome)
  );
}

/**
 * Ordem dentro de um bloco: posição, com NULO POR ÚLTIMO, e o nome no empate.
 *
 * ⚠️ É o espelho exato do `.order('posicao', { nullsFirst: false })
 * .order('field_name')` das consultas. Quem mudar um lado muda o outro: as
 * telas ordenam no banco, mas o catálogo reordena na mão depois de arrastar e
 * precisa chegar no mesmo lugar que o próximo carregamento vai mostrar.
 */
export function ordenarCampos(campos: CustomField[]): CustomField[] {
  return [...campos].sort((a, b) => {
    const pa = a.posicao ?? null;
    const pb = b.posicao ?? null;
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    return a.field_name.localeCompare(b.field_name);
  });
}

/**
 * Reparte os campos em blocos, na ordem em que a tela os mostra.
 *
 * @param incluirVazios O catálogo precisa do bloco vazio (é onde se solta o
 *   primeiro campo dele, e sem ele um grupo recém-criado sumiria da tela que o
 *   criou). A ficha do cliente não: cabeçalho sozinho, sem campo embaixo, não
 *   informa nada e ainda ocupa a coluna estreita da conversa.
 */
export function agruparCampos(
  campos: CustomField[],
  grupos: GrupoDeCampos[],
  { incluirVazios = false }: { incluirVazios?: boolean } = {}
): BlocoDeCampos[] {
  const porGrupo = new Map<string, CustomField[]>();
  const geral: CustomField[] = [];
  const conhecidos = new Set(grupos.map((g) => g.id));

  for (const campo of campos) {
    // ⚠️ Grupo que não veio na lista cai no Geral, nunca no limbo. Sob RLS as
    // duas consultas enxergam a mesma conta, então isto só acontece em corrida
    // (outro admin apagou o grupo entre as duas cargas) — e nesse instante o
    // certo é o campo APARECER em algum lugar. Sumir seria a tela afirmando
    // que o campo não existe mais.
    const id = campo.grupo_id;
    if (!id || !conhecidos.has(id)) {
      geral.push(campo);
      continue;
    }
    const lista = porGrupo.get(id);
    if (lista) lista.push(campo);
    else porGrupo.set(id, [campo]);
  }

  const blocos: BlocoDeCampos[] = [];
  if (geral.length > 0) blocos.push({ grupo: null, campos: ordenarCampos(geral) });

  for (const grupo of ordenarGrupos(grupos)) {
    const doGrupo = porGrupo.get(grupo.id) ?? [];
    if (doGrupo.length === 0 && !incluirVazios) continue;
    blocos.push({ grupo, campos: ordenarCampos(doGrupo) });
  }

  return blocos;
}

/** A chave de um bloco no arrastar — `null` (o Geral) não tem id de banco. */
export function chaveDoBloco(grupoId: string | null): string {
  return grupoId ?? 'geral';
}

/**
 * Move um campo para junto de outro (`alvo` = id de campo) ou para o fim de um
 * bloco (`alvo` = chave de bloco, de {@link chaveDoBloco}) — o segundo caso é o
 * que faz um bloco VAZIO aceitar o primeiro campo dele.
 *
 * Devolve os blocos já reordenados, ou `null` quando não há nada a fazer: o
 * campo caiu onde já estava, ou o alvo não existe mais. Devolver `null` em vez
 * de uma cópia idêntica é o que permite ao chamador não gravar nada — um
 * arrastar que não moveu ninguém não pode virar uma escrita no banco.
 */
export function moverCampo(
  blocos: BlocoDeCampos[],
  campoId: string,
  alvo: string
): BlocoDeCampos[] | null {
  const origem = blocos.findIndex((b) => b.campos.some((c) => c.id === campoId));
  if (origem < 0) return null;

  const campo = blocos[origem].campos.find((c) => c.id === campoId);
  if (!campo) return null;

  // O alvo é um CAMPO ou um BLOCO. Campo primeiro: soltar em cima de um campo
  // é o gesto comum, e uma chave de bloco nunca colide com um uuid de campo.
  let destino = blocos.findIndex((b) => b.campos.some((c) => c.id === alvo));
  let indice: number;
  if (destino >= 0) {
    indice = blocos[destino].campos.findIndex((c) => c.id === alvo);
  } else {
    destino = blocos.findIndex(
      (b) => chaveDoBloco(b.grupo?.id ?? null) === alvo
    );
    if (destino < 0) return null;
    indice = blocos[destino].campos.length;
  }

  if (origem === destino) {
    const atual = blocos[origem].campos.findIndex((c) => c.id === campoId);
    if (atual === indice) return null;
  }

  const copia = blocos.map((b) => ({ ...b, campos: [...b.campos] }));
  const [removido] = copia[origem].campos.splice(
    copia[origem].campos.findIndex((c) => c.id === campoId),
    1
  );
  // Inserir no índice que o alvo tinha ANTES da remoção é exatamente o
  // `arrayMove` do dnd-kit: arrastando para baixo, o alvo já subiu uma casa e
  // o campo cai depois dele; para cima, o alvo não se moveu e o campo cai
  // antes. É o que a animação do arrastar mostrou ao operador.
  copia[destino].campos.splice(indice, 0, removido);
  return copia;
}

/**
 * O payload da RPC `cb_ordenar_campos_personalizados` para um bloco inteiro:
 * cada campo com o grupo do bloco e a posição igual ao índice em que ele
 * aparece na tela.
 *
 * ⚠️ Manda o BLOCO INTEIRO, não só quem se moveu. Reordenar por diferença
 * exigiria confiar que as posições no banco são densas e sem buraco — e elas
 * não são: campo novo nasce com `posicao` NULA e o semeador cria vários de uma
 * vez. Reescrever 0..N-1 normaliza o bloco a cada arrastar.
 */
export function posicoesDoBloco(
  campos: CustomField[],
  grupoId: string | null
): Array<{ id: string; grupo_id: string | null; posicao: number }> {
  return campos.map((campo, i) => ({
    id: campo.id,
    grupo_id: grupoId,
    posicao: i,
  }));
}
