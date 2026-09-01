// ============================================================
// Campo personalizado que salva sozinho (Fase B1).
//
// As DUAS perguntas que as três superfícies de edição precisam responder
// igual: "que gesto confirma este campo?" e "mudou de verdade?". Duas cópias
// divergiriam na primeira correção — e divergir aqui é gravar (ou não gravar)
// coisa diferente para o mesmo gesto, em telas que editam o MESMO dado.
// ============================================================

/**
 * O gesto que confirma o campo é SAIR dele (`blur`)?
 *
 * ⚠️ `select` é a exceção, e é o mesmo raciocínio do seletor de etapa do
 * negócio: escolher no popover JÁ é o gesto inteiro — o popover fecha e não
 * há blur útil para esperar. Nos demais, gravar a cada tecla escreveria uma
 * linha por letra digitada.
 *
 * ⚠️ O campo de DATA fica no blur de propósito, apesar de o `<input
 * type="datetime-local">` disparar `change`: ele dispara a cada PEDAÇO
 * digitado, com valores intermediários que são datas de verdade e absurdas
 * ("0002-01-01" a caminho de "2026-01-01"). Gravar isso encheria a coluna de
 * lixo — e a 935 lê essa coluna para disparar lembrete.
 */
export function gravaAoSair(fieldType: string): boolean {
  return fieldType !== "select";
}

/** O contrário: o gesto é a própria escolha. */
export function gravaAoEscolher(fieldType: string): boolean {
  return !gravaAoSair(fieldType);
}

/**
 * O valor mudou, do ponto de vista do que fica GRAVADO?
 *
 * ⚠️ Compara APARADO porque `salvarValoresDoContato` grava `v.trim()` e trata
 * `""` como exclusão da linha. Sem o `trim` dos dois lados, entrar num campo
 * que a automação preencheu com `" 300 "` e sair sem tocar em nada gravaria
 * `"300"` — uma escrita no banco que ninguém pediu, e que num CRM jurídico
 * aparece como "alguém editou a ficha".
 */
export function valorMudou(salvo: string, novo: string): boolean {
  return salvo.trim() !== novo.trim();
}

// ------------------------------------------------------------
// A fila de gravação de UM campo
// ------------------------------------------------------------

/** Como a gravação está, para o indicador ao lado do rótulo. */
export type EstadoDaGravacao = "parado" | "gravando" | "salvo";

export interface FilaDeGravacao {
  /** Põe o valor na fila. Ignora o que não mudou em relação ao já gravado. */
  enfileirar: (valor: string) => void;
  /** O último valor que o banco CONFIRMOU. */
  salvo: () => string;
  /** Há gravação em voo? */
  emVoo: () => boolean;
}

/**
 * Serializa as gravações de um campo e faz o ÚLTIMO valor vencer.
 *
 * ⚠️⚠️ EXISTE PORQUE DUAS GRAVAÇÕES CONCORRENTES CHEGAM AO BANCO FORA DE
 * ORDEM. Mudar uma lista duas vezes rápido, ou sair-voltar-editar-sair antes
 * de a primeira requisição terminar, dispara dois upserts na mesma linha: se o
 * ANTIGO chegar por último, ele sobrescreve a edição mais nova — no banco e no
 * `salvo()` — e o operador não vê nada acontecer. É a mesma classe da divergência
 * silenciosa que o `emVoo` das favoritas (924) resolve, aqui por campo.
 *
 * ⚠️ O pendente guarda só o MAIS NOVO, de propósito. Enfileirar tudo mandaria
 * ao banco estados intermediários que ninguém quer ver gravados — o que
 * importa é onde o campo PAROU.
 *
 * Falha não limpa o pendente: se houver valor novo esperando, ele é tentado na
 * volta. Sem pendente, a fila para e quem chama avisa o operador — o próximo
 * blur tenta de novo.
 */
export function criarFilaDeGravacao(
  inicial: string,
  gravar: (valor: string) => Promise<boolean>,
  aoMudarEstado?: (estado: EstadoDaGravacao) => void,
): FilaDeGravacao {
  /** O que o banco CONFIRMOU. */
  let salvo = inicial;
  /**
   * O que QUEREMOS que o banco tenha.
   *
   * ⚠️ É contra ele que `enfileirar` decide se há novidade — não contra
   * `salvo`. Enquanto uma gravação está em voo, `salvo` ainda é o valor
   * ANTIGO: comparar com ele faria "desfazer para o valor original antes de a
   * requisição voltar" parecer um não-evento, e o campo terminaria mostrando
   * o valor de antes com o banco guardando o de depois. Achado pelo próprio
   * teste desta fila.
   */
  let desejado = inicial;
  let rodando = false;
  let pendente: string | null = null;

  const laco = async (primeiro: string) => {
    rodando = true;
    aoMudarEstado?.("gravando");
    let atual = primeiro;
    for (;;) {
      let ok = false;
      try {
        ok = await gravar(atual);
      } catch (err) {
        // ⚠️ Rejeição é FALHA, não fim do laço (#10 do plano de 31/08). O
        // contrato de `gravar` é resolver boolean, mas um `createClient()`
        // que estoura ou um toast que quebra na formatação REJEITAM — e sem
        // este catch o laço abandonava com `rodando = true` para sempre:
        // spinner eterno, todo `enfileirar` caindo no pendente que ninguém
        // consome, e nada mais gravado naquele campo, nem na descarga de
        // desmonte. Quem toasta é o chamador; aqui registra e segue.
        console.error("[salvamento-de-campo] gravar rejeitou:", err);
        ok = false;
      }
      if (ok) salvo = atual;
      // Falhou: volta a régua para o que o banco tem, senão o MESMO gesto
      // repetido pelo operador seria descartado como "não mudou" e a
      // tentativa de novo nunca sairia.
      // ⚠️ SÓ quando não há pendente (#09): com pendente na fila, `desejado`
      // já aponta para o valor MAIS NOVO — reverter aqui o deixava preso num
      // valor que o banco não teria mais assim que o pendente gravasse, e o
      // gesto de DESFAZER de volta ao original era engolido como "não
      // mudou": a tela mostrando uma coisa, o banco guardando outra, sem
      // spinner nem toast.
      else if (pendente === null) desejado = salvo;
      const proximo = pendente;
      pendente = null;
      if (proximo === null) {
        rodando = false;
        aoMudarEstado?.(ok ? "salvo" : "parado");
        return;
      }
      atual = proximo;
    }
  };

  return {
    enfileirar: (valor) => {
      if (!valorMudou(desejado, valor)) return;
      desejado = valor;
      if (rodando) {
        pendente = valor;
        return;
      }
      void laco(valor);
    },
    salvo: () => salvo,
    emVoo: () => rodando,
  };
}
