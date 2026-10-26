import { describe, expect, it } from 'vitest'

import ptBR from '../../../messages/pt-BR.json'

import { ferramentasPedidasDesligadas } from './instrucoes-x-ferramentas'
import { TIPOS_DE_ACAO, type TipoDeAcao } from './tipos'

// ============================================================
// As instruções pedem uma ação cuja ferramenta está DESLIGADA (validação de
// 25/10/2026: com "Criar tarefa" desligada e a instrução pedindo o lembrete,
// o agente respondeu "Criei o lembrete…" e nada foi criado). Heurística
// CONSERVADORA: o alarme falso ensina a ignorar o aviso.
// ============================================================

const NADA: TipoDeAcao[] = []

function tipos(texto: string, ligadas: readonly TipoDeAcao[] = NADA): TipoDeAcao[] {
  return ferramentasPedidasDesligadas([texto], ligadas).map((f) => f.tipo)
}

describe('ferramentasPedidasDesligadas — o pedido de cada ferramenta', () => {
  it.each<[string, TipoDeAcao]>([
    ['Quando o cliente pedir, crie um lembrete para a Ana ligar amanhã.', 'criar_tarefa'],
    ['Crie uma tarefa para o advogado responsável.', 'criar_tarefa'],
    ['Uma tarefa deve ser criada para a equipe.', 'criar_tarefa'],
    ['Adicione a etiqueta VIP quando a dívida passar de 150 mil.', 'etiquetar'],
    ['Etiquete o contato conforme a área.', 'etiquetar'],
    ['Tire a etiqueta "Sem resposta" quando o cliente voltar.', 'tirar_etiqueta'],
    ['Registre no campo Tamanho da dívida o valor que o cliente informar.', 'preencher_campo'],
    ['Pergunte o valor da dívida e anote.', 'preencher_campo'],
    ['Grave o e-mail do cliente.', 'preencher_campo'],
    ['Atualize a ficha com o nome completo.', 'preencher_campo'],
    ['Depois de qualificar, mova o card para Qualificado.', 'mover_etapa'],
    ['Mova o cliente para a etapa Proposta.', 'mover_etapa'],
    ['Passe o card para a próxima coluna do funil.', 'mover_etapa'],
    ['Execute a automação de boas-vindas.', 'executar_automacao'],
    ['Ofereça os horários livres e agende a reunião no que o cliente escolher.', 'marcar_reuniao'],
    ['Marque um horário com o advogado.', 'marcar_reuniao'],
    ['Seu objetivo é agendar uma consulta.', 'marcar_reuniao'],
  ])('%s → %s', (texto, tipo) => {
    expect(tipos(texto)).toEqual([tipo])
  })

  it('acento, caixa e "e-mail" não mudam nada', () => {
    expect(tipos('EXECUTE A AUTOMAÇÃO DE ENTRADA')).toEqual(['executar_automacao'])
    expect(tipos('execute a automacao de entrada')).toEqual(['executar_automacao'])
    expect(tipos('Salve o email no cadastro')).toEqual(['preencher_campo'])
  })

  it('várias no mesmo texto: na ordem de TIPOS_DE_ACAO, uma vez cada, com o PRIMEIRO trecho', () => {
    const achadas = ferramentasPedidasDesligadas(
      [
        'Agende a reunião no horário escolhido.\nCrie uma tarefa para a Ana, e crie outra tarefa para o Rui.\nMova o card para Reunião Agendada.',
      ],
      NADA,
    )
    expect(achadas).toEqual([
      { tipo: 'mover_etapa', trecho: 'Mova o card para Reunião Agendada' },
      { tipo: 'criar_tarefa', trecho: 'Crie uma tarefa para a Ana' },
      { tipo: 'marcar_reuniao', trecho: 'Agende a reunião no horário escolhido' },
    ])
  })

  it('lê as instruções E as regras (os dois vão ao modelo)', () => {
    expect(
      ferramentasPedidasDesligadas(['Atenda com cordialidade.', 'Sempre crie uma tarefa quando houver urgência.'], NADA).map(
        (f) => f.tipo,
      ),
    ).toEqual(['criar_tarefa'])
  })
})

describe('ferramentasPedidasDesligadas — ligada não avisa', () => {
  it('a ferramenta ligada some do aviso; as outras ficam', () => {
    const texto = 'Crie uma tarefa para a Ana. Adicione a etiqueta VIP.'
    expect(tipos(texto)).toEqual(['etiquetar', 'criar_tarefa'])
    expect(tipos(texto, ['criar_tarefa'])).toEqual(['etiquetar'])
    expect(tipos(texto, ['criar_tarefa', 'etiquetar'])).toEqual([])
  })

  it('tudo ligado = nada a avisar', () => {
    expect(tipos('Crie uma tarefa, mova o card, agende a reunião e execute a automação.', TIPOS_DE_ACAO)).toEqual([])
  })
})

describe('ferramentasPedidasDesligadas — o que NÃO pede ferramenta (conservadora)', () => {
  it.each([
    // Negação no trecho.
    'Nunca mova o card para Perdido.',
    'Não crie tarefas: apenas responda.',
    'Nenhuma etiqueta deve ser aplicada pelo agente.',
    'Jamais execute automações.',
    // A palavra solta, sem verbo de ação.
    'Explique que na reunião o advogado vai analisar o caso.',
    'Os lembretes da reunião saem sozinhos pelo e-mail do Calendly.',
    'Uma automação manda a mensagem de boas-vindas.',
    'Consulte o campo Tamanho da dívida antes de perguntar.',
    'Você atende os cards da etapa Lead.',
    // "Mover a ação" é a ação JUDICIAL; "etapa" do roteiro do prompt; o cartão de crédito.
    'Explique que vamos mover a ação contra o banco.',
    'Etapa 1: cumprimente. Depois passe para a etapa 2 e pergunte o valor.',
    'Passe o valor do cartão de crédito para o cliente confirmar.',
    // O sujeito é outro.
    'Peça para o cliente agendar a reunião.',
    'A equipe vai marcar o horário com o cliente.',
    'Oriente o cliente a registrar um boletim de ocorrência.',
    // O link: quem marca é o cliente.
    'Se o cliente quiser marcar uma reunião, envie o link de agendamento.',
    'Para quem faltou, ofereça remarcar pelo link de agendamento.',
    // Particípio na reunião fala da que já existe.
    'Se a reunião já estiver marcada, informe a data.',
    // "Registre" e "grave" sozinhos.
    'Peça que ele grave um áudio explicando o caso.',
    // "Passe para a equipe" não é mover o card.
    'Quando entender o assunto, passe para a equipe certa.',
  ])('%s', (texto) => {
    expect(tipos(texto)).toEqual([])
  })

  it('a condição com negação não cala o pedido do trecho seguinte', () => {
    expect(tipos('Se o cliente não responder, crie uma tarefa para a Ana.')).toEqual(['criar_tarefa'])
  })

  it('"registre uma tarefa" é tarefa, não campo', () => {
    expect(tipos('Registre uma tarefa para o advogado.')).toEqual(['criar_tarefa'])
  })

  it('os modelos de partida do dicionário não acendem aviso nenhum', () => {
    for (const [nome, m] of Object.entries(ptBR.IaAgentes.modelos)) {
      expect(ferramentasPedidasDesligadas([m.instrucoes, m.regras], NADA), nome).toEqual([])
    }
  })

  it('vazio não acende nada', () => {
    expect(ferramentasPedidasDesligadas([], NADA)).toEqual([])
    expect(ferramentasPedidasDesligadas(['', '   \n '], NADA)).toEqual([])
  })
})

describe('ferramentasPedidasDesligadas — o trecho mostrado', () => {
  it('como foi escrito (acento e caixa), sem espaço sobrando', () => {
    expect(ferramentasPedidasDesligadas(['  Crie   uma tarefa   para a Ana  '], NADA)).toEqual([
      { tipo: 'criar_tarefa', trecho: 'Crie uma tarefa para a Ana' },
    ])
  })

  it('trecho longo é cortado com reticências', () => {
    const longo = `Crie uma tarefa ${'para revisar o caso '.repeat(20)}`
    const [achada] = ferramentasPedidasDesligadas([longo], NADA)
    expect(achada.trecho.length).toBeLessThanOrEqual(120)
    expect(achada.trecho.endsWith('…')).toBe(true)
  })
})
