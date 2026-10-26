// ============================================================
// INSTRUÇÕES × FERRAMENTAS (validação de 25/10/2026). As instruções do agente
// pedem uma AÇÃO ("crie uma tarefa para a Ana", "mova o card para
// Qualificado") cuja ferramenta está DESLIGADA na aba Ferramentas: o agente
// não tem como fazê-la, e o modelo, mandado fazer, PROMETE ao cliente o que
// não acontece. A trava do motor (a resposta que promete ação sem o
// marcador) é a defesa no turno; esta é a da TELA, antes de o agente ir ao
// ar: a aba Ferramentas avisa "As instruções pedem <X>, mas a ferramenta está
// desligada". PURO, testado.
//
// ⚠️ Heurística CONSERVADORA de propósito — o aviso que erra para menos é
// melhor que o alarme falso, que ensina o administrador a ignorar o âmbar:
//   - casa VERBO de ação + OBJETO a até `JANELA` palavras ("crie uma tarefa",
//     "o card deve ser movido"), nunca a palavra solta: "a reunião vai
//     analisar o caso", "os lembretes saem sozinhos" e "mover a ação contra o
//     banco" (a ação JUDICIAL) não pedem ferramenta nenhuma;
//   - o trecho (entre vírgula, ponto, `;`, `:` ou quebra de linha) com
//     negação ("não", "nunca", "nenhum"…) não conta;
//   - verbo cujo sujeito é outro ("o cliente agenda", "a equipe vai marcar")
//     não conta;
//   - "marcar reunião" na FRASE que fala de link não conta: é o cliente quem
//     marca pelo link do Calendly, e o agente que manda o link não precisa da
//     ferramenta;
//   - "etapa" só com "mover" (o roteiro do prompt tem "etapa 2: pergunte…") e
//     nunca "cartão" (no Bancário, é o cartão de crédito).
// Limite aceito: frase fora dessas formas passa sem aviso.
// ============================================================

import { semAcento } from '@/lib/inbox/busca-em-mensagens'

import { TIPOS_DE_ACAO, type TipoDeAcao } from './tipos'

/** Quantas palavras podem separar o verbo do objeto (nos dois sentidos). */
const JANELA = 4

/** Teto do trecho mostrado na tela (o administrador acha o resto nas Instruções). */
const TETO_DO_TRECHO = 120

const NEGACOES: ReadonlySet<string> = new Set([
  'nao',
  'nunca',
  'jamais',
  'nem',
  'nenhum',
  'nenhuma',
  'evite',
  'evitar',
  'proibido',
  'proibida',
])

/** Quem, logo antes do verbo (até duas palavras), faz a ação no lugar do agente. */
const OUTRO_SUJEITO: ReadonlySet<string> = new Set([
  'cliente',
  'clientes',
  'ele',
  'ela',
  'eles',
  'elas',
  'lead',
  'equipe',
  'time',
  'advogado',
  'advogada',
  'atendente',
  'humano',
])

interface Regra {
  tipo: TipoDeAcao
  verbos: ReadonlySet<string>
  /** O objeto perto do verbo; `null` = o verbo basta ("anote"). */
  objetos: ReadonlySet<string> | null
  /** Palavra que, no TRECHO, tira a regra ("registre uma tarefa" não é campo). */
  excetoNoTrecho?: ReadonlySet<string>
  /** Palavra que, na FRASE, tira a regra (o link: quem marca é o cliente). */
  excetoNaFrase?: ReadonlySet<string>
}

const conjunto = (...p: string[]): ReadonlySet<string> => new Set(p)

const ETIQUETA = conjunto('etiqueta', 'etiquetas', 'tag', 'tags')
const TAREFA = conjunto('tarefa', 'tarefas', 'lembrete', 'lembretes')
const VERBOS_DE_GRAVAR = conjunto(
  'preencha',
  'preencher',
  'preenchido',
  'preenchida',
  'atualize',
  'atualizar',
  'grave',
  'gravar',
  'salve',
  'salvar',
  'guarde',
  'guardar',
  'registre',
  'registrar',
  'anote',
  'anotar',
  'insira',
  'inserir',
  'coloque',
  'colocar',
  'escreva',
  'escrever',
)

/** A ordem não importa: o resultado sai na ordem de `TIPOS_DE_ACAO`. */
const REGRAS: readonly Regra[] = [
  {
    tipo: 'mover_etapa',
    verbos: conjunto(
      'mova',
      'mover',
      'movido',
      'movida',
      'mude',
      'mudar',
      'avance',
      'avancar',
      'passe',
      'passar',
      'leve',
      'levar',
      'coloque',
      'colocar',
      'transfira',
      'transferir',
      'jogue',
      'jogar',
      'arraste',
      'arrastar',
    ),
    objetos: conjunto('card', 'cards', 'funil'),
  },
  // "etapa" só com "mover": "passe para a etapa 2" é o roteiro da conversa.
  { tipo: 'mover_etapa', verbos: conjunto('mova', 'mover', 'movido', 'movida'), objetos: conjunto('etapa', 'etapas', 'coluna') },
  {
    tipo: 'etiquetar',
    verbos: conjunto(
      'adicione',
      'adicionar',
      'coloque',
      'colocar',
      'aplique',
      'aplicar',
      'marque',
      'marcar',
      'ponha',
      'inclua',
      'incluir',
      'use',
      'usar',
      'atribua',
      'atribuir',
      'etiquete',
      'etiquetar',
    ),
    objetos: ETIQUETA,
  },
  { tipo: 'etiquetar', verbos: conjunto('etiquete', 'etiquetar'), objetos: null },
  {
    tipo: 'tirar_etiqueta',
    verbos: conjunto('tire', 'tirar', 'remova', 'remover', 'retire', 'retirar', 'exclua', 'excluir', 'apague', 'apagar'),
    objetos: ETIQUETA,
  },
  {
    tipo: 'preencher_campo',
    verbos: VERBOS_DE_GRAVAR,
    objetos: conjunto('campo', 'campos', 'ficha', 'cadastro', 'crm', 'email'),
    excetoNoTrecho: TAREFA,
  },
  // "Anote" sozinho é pedido de gravar; "registre"/"grave" sozinhos, não
  // ("registre um boletim de ocorrência", "grave um áudio").
  { tipo: 'preencher_campo', verbos: conjunto('anote', 'anotar'), objetos: null, excetoNoTrecho: TAREFA },
  {
    tipo: 'criar_tarefa',
    verbos: conjunto(
      'crie',
      'criar',
      'cria',
      'criada',
      'criado',
      'abra',
      'abrir',
      'aberta',
      'gere',
      'gerar',
      'gerada',
      'deixe',
      'deixar',
      'agende',
      'agendar',
      'programe',
      'programar',
      'registre',
      'registrar',
      'lance',
      'lancar',
      'cadastre',
      'cadastrar',
    ),
    objetos: TAREFA,
  },
  {
    tipo: 'executar_automacao',
    verbos: conjunto(
      'execute',
      'executar',
      'rode',
      'rodar',
      'dispare',
      'disparar',
      'acione',
      'acionar',
      'ative',
      'ativar',
      'inicie',
      'iniciar',
      'chame',
      'chamar',
      'use',
      'usar',
    ),
    objetos: conjunto('automacao', 'automacoes'),
  },
  {
    tipo: 'marcar_reuniao',
    // Sem particípio: "se a reunião já estiver marcada" fala da que existe.
    verbos: conjunto('agende', 'agendar', 'marque', 'marcar', 'remarque', 'remarcar', 'reagende', 'reagendar'),
    objetos: conjunto(
      'reuniao',
      'reunioes',
      'horario',
      'horarios',
      'consulta',
      'consultas',
      'videochamada',
      'call',
      'atendimento',
    ),
    excetoNaFrase: conjunto('link', 'links'),
  },
]

/** As palavras do texto, sem acento e em minúsculas ("e-mail" vira "email"). */
function palavras(texto: string): string[] {
  return (semAcento(texto).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).map((p) => (p === 'e-mail' ? 'email' : p))
}

function temAlguma(lista: readonly string[], conj: ReadonlySet<string> | undefined): boolean {
  return !!conj && lista.some((p) => conj.has(p))
}

/** O trecho pede a ação da regra? (o verbo, com o objeto perto, e o sujeito não é outro) */
function casa(regra: Regra, trecho: readonly string[]): boolean {
  if (temAlguma(trecho, regra.excetoNoTrecho)) return false
  return trecho.some((p, i) => {
    if (!regra.verbos.has(p)) return false
    if (OUTRO_SUJEITO.has(trecho[i - 1] ?? '') || OUTRO_SUJEITO.has(trecho[i - 2] ?? '')) return false
    if (!regra.objetos) return true
    const de = Math.max(0, i - JANELA - 1)
    const ate = Math.min(trecho.length, i + JANELA + 2)
    return trecho.slice(de, ate).some((q, j) => de + j !== i && regra.objetos!.has(q))
  })
}

function encurtar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > TETO_DO_TRECHO ? `${limpo.slice(0, TETO_DO_TRECHO - 1).trimEnd()}…` : limpo
}

export interface FerramentaPedida {
  tipo: TipoDeAcao
  /** O trecho das instruções que pediu (o primeiro), como foi escrito. */
  trecho: string
}

/**
 * As ferramentas que os TEXTOS do agente (as instruções e as regras) pedem e
 * que NÃO estão em `ligadas`, na ordem de `TIPOS_DE_ACAO`, cada uma com o
 * primeiro trecho que a pediu. Vazio = nada a avisar.
 */
export function ferramentasPedidasDesligadas(
  textos: readonly string[],
  ligadas: readonly TipoDeAcao[],
): FerramentaPedida[] {
  const achadas = new Map<TipoDeAcao, string>()
  for (const texto of textos) {
    for (const frase of texto.split(/[.!?\n]+/)) {
      const palavrasDaFrase = palavras(frase)
      for (const trecho of frase.split(/[,;:]+/)) {
        const p = palavras(trecho)
        if (p.length === 0 || temAlguma(p, NEGACOES)) continue
        for (const regra of REGRAS) {
          if (ligadas.includes(regra.tipo) || achadas.has(regra.tipo)) continue
          if (temAlguma(palavrasDaFrase, regra.excetoNaFrase)) continue
          if (casa(regra, p)) achadas.set(regra.tipo, encurtar(trecho))
        }
      }
    }
  }
  return TIPOS_DE_ACAO.filter((t) => achadas.has(t)).map((tipo) => ({ tipo, trecho: achadas.get(tipo)! }))
}
