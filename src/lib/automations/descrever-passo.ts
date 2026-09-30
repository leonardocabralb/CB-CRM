import type {
  AtlasAtualizarClienteStepConfig,
  AtlasAtualizarOnboardingStepConfig,
  AtlasCriarTarefaStepConfig,
  AutomationRefStepConfig,
  AutomationStepType,
  ConditionStepConfig,
  CreateDealStepConfig,
  CreateTaskStepConfig,
  MoveDealStepConfig,
  RunFlowStepConfig,
  SendMediaStepConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendToNumberStepConfig,
  SetAiStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
} from '@/types'
import { formatarTelefone, telefoneDigitado } from '@/lib/contacts/telefone'
import { rotuloDaJanela } from './hora-do-dia'
import { operadorDaCondicao, operadorPedeValor } from './condicao-por-campo'
import { SITUACOES_ESCREVIVEIS } from '@/lib/atlas/passos-do-atlas'

/**
 * "O que esta automação FAZ", em uma linha — o texto em negrito do cartão da
 * grade do funil ("Adicionar tags: DESQUALIFICADO").
 *
 * ⚠️ Devolve CHAVE + valores, nunca texto pronto. O app roda em português e o
 * dicionário é a única fonte de tradução; frase montada aqui nasceria em
 * inglês ou duplicaria o `messages/`. Quem consome faz
 * `t(\`resumo.\${chave}\`, valores)`.
 *
 * ⚠️ **Todo `AutomationStepType` PRECISA de uma chave nos dois dicionários.**
 * O fallback do next-intl é por ARQUIVO, não por chave: faltando uma, a tela
 * mostra `Pipelines.automacoes.resumo.send_x` cru para o operador. Há teste
 * lendo `messages/pt-BR.json` e cobrando uma chave por tipo — é ele que
 * segura isso, não a boa vontade de quem adicionar o próximo passo.
 */

/** Nomes já carregados pela tela, para trocar id por rótulo legível. */
export interface NomesConhecidos {
  tags?: Record<string, string>
  etapas?: Record<string, string>
  fluxos?: Record<string, string>
  automacoes?: Record<string, string>
  canais?: Record<string, string>
  /** `custom_fields.id` → nome do campo (a condição por campo, 2.10). */
  campos?: Record<string, string>
}

export interface ResumoDoPasso {
  /** Sufixo da chave de tradução. Sempre igual ao `step_type`. */
  chave: AutomationStepType | string
  /** Valores para o ICU. `alvo` é o trecho que a tela destaca. */
  valores: Record<string, string | number>
  /**
   * O alvo era um id que não existe mais (tag apagada, robô excluído).
   *
   * ⚠️ A tela precisa disso: mostrar o UUID cru faria o operador achar que é
   * o nome, e mostrar vazio faria "Adicionar tags:" seguido de nada — que
   * parece defeito de renderização, não config quebrada.
   */
  alvoSumiu: boolean
}

interface PassoResumivel {
  step_type: AutomationStepType | string
  step_config?: unknown
}

export function descreverPasso(passo: PassoResumivel, nomes: NomesConhecidos = {}): ResumoDoPasso {
  const cfg = (passo.step_config ?? {}) as Record<string, unknown>
  const tipo = passo.step_type

  const porId = (mapa: Record<string, string> | undefined, id: unknown): ResumoDoPasso => {
    const chaveId = typeof id === 'string' ? id : ''
    const nome = chaveId ? mapa?.[chaveId] : undefined
    return {
      chave: tipo,
      valores: { alvo: nome ?? '' },
      alvoSumiu: !nome,
    }
  }

  const simples = (alvo: string | number = ''): ResumoDoPasso => ({
    chave: tipo,
    valores: { alvo },
    alvoSumiu: false,
  })

  switch (tipo) {
    case 'add_tag':
    case 'remove_tag':
      return porId(nomes.tags, (cfg as unknown as TagStepConfig).tag_id)

    case 'run_flow':
      return porId(nomes.fluxos, (cfg as unknown as RunFlowStepConfig).flow_id)

    case 'run_automation':
    case 'stop_automation':
      return porId(nomes.automacoes, (cfg as unknown as AutomationRefStepConfig).automation_id)

    case 'move_deal_stage':
      return porId(nomes.etapas, (cfg as unknown as MoveDealStepConfig).stage_id)

    case 'create_deal':
      return simples((cfg as unknown as CreateDealStepConfig).title ?? '')

    case 'set_deal_status': {
      // O status é um enum curto; o rótulo vem do dicionário, não daqui.
      const s = (cfg as unknown as MoveDealStepConfig).status
      return { chave: `set_deal_status_${s ?? 'open'}`, valores: {}, alvoSumiu: false }
    }

    case 'set_ai':
      // Ligar e desligar são ações OPOSTAS. Uma frase só com "alvo: ligado"
      // faria as duas ficarem parecidas no meio de um quadro cheio.
      return {
        chave: (cfg as unknown as SetAiStepConfig).enabled ? 'set_ai_on' : 'set_ai_off',
        valores: {},
        alvoSumiu: false,
      }

    case 'send_message':
      return simples(recortar((cfg as unknown as SendMessageStepConfig).text))

    case 'send_template':
      return simples((cfg as unknown as SendTemplateStepConfig).template_name ?? '')

    case 'send_media':
      // O tipo do arquivo é mais informativo que a URL, que é ilegível.
      return {
        chave: `send_media_${(cfg as unknown as SendMediaStepConfig).kind ?? 'image'}`,
        valores: {},
        alvoSumiu: false,
      }

    case 'update_contact_field': {
      // O campo é gravado como o motor o lê: "name"/"email"/"company" ou
      // "custom:<id>". Cru, o cartão dizia "Alterar campo do contato:
      // custom:3888de41-…" — o id no lugar do nome, e "name" em inglês.
      const campo = String((cfg as unknown as UpdateContactFieldStepConfig).field ?? '').trim()
      if (campo === 'name' || campo === 'email' || campo === 'company') {
        return { chave: `update_contact_field_${campo}`, valores: {}, alvoSumiu: false }
      }
      if (campo.startsWith('custom:')) return porId(nomes.campos, campo.slice('custom:'.length))
      return simples(campo)
    }

    case 'send_to_number': {
      // O número, legível: é o que distingue dois avisos no mesmo quadro. A
      // mesma leitura do motor — "(83) 98000-0016" digitado sem DDI ganha o
      // 55 antes de ser formatado, senão sairia "+83980000016". Número que a
      // régua recusa aparece como foi escrito: em branco, o cartão da
      // automação que vai falhar ficaria "Avisar o número:" sem destino, com
      // cara de defeito de tela; formatado, "98000-0016" viraria "+980000016".
      const phone = (cfg as unknown as SendToNumberStepConfig).phone
      const lido = telefoneDigitado(phone)
      return simples(lido.ok ? formatarTelefone(lido.digitos) : typeof phone === 'string' ? phone.trim() : '')
    }

    case 'wait': {
      const w = cfg as unknown as WaitStepConfig
      // "Aguardar 30 h" e "Aguardar 30 h ou até o cliente responder" são
      // passos DIFERENTES para quem lê a grade ou a linha do tempo da
      // conversa: no segundo, a resposta do cliente encerra o que vem depois.
      // Chave própria (e não sufixo colado na tela) porque a frase muda de
      // forma entre os idiomas. `=== true`, como o motor.
      const sufixo = w.parar_se_responder === true ? '_ou_resposta' : ''
      // "Aguardar até estar dentro do horário" (26/09/2026): chave própria,
      // com a janela e o "de segunda a sexta" — é o que distingue duas
      // esperas da cadência na grade. `amount`/`unit` ficam gravados nesse
      // modo e NÃO valem; mostrá-los diria "Aguardar 1 h" sobre uma espera
      // até as 8h. Janela ilegível sai "—" (a ativação já a recusa).
      if (w.modo === 'horario') {
        const rotulo = rotuloDaJanela(w.janela)
        const dias = w.somente_seg_a_sex === true ? '_seg_a_sex' : ''
        return {
          chave: `wait_horario${dias}${sufixo}`,
          valores: { inicio: rotulo?.inicio ?? '—', fim: rotulo?.fim ?? '—' },
          alvoSumiu: false,
        }
      }
      return {
        chave: `wait_${w.unit ?? 'hours'}${sufixo}`,
        valores: { quantidade: Number(w.amount ?? 0) },
        alvoSumiu: false,
      }
    }

    case 'condition': {
      // A condição por CAMPO PERSONALIZADO (2.10) diz QUAL campo e o quê — é
      // ela que distingue "volta ao robô" de "desqualificado por outro
      // motivo" na grade e na linha do tempo. Chave por operador (a frase
      // muda de forma: "está vazio" não tem valor). As outras condições
      // continuam "Verificar uma condição". Campo que o catálogo não conhece
      // vira "(apagado)", nunca o UUID.
      const c = cfg as unknown as ConditionStepConfig
      const op = c.subject === 'custom_field' ? operadorDaCondicao(c.operator) : null
      if (!op) return simples()
      const campoId = typeof c.operand === 'string' ? c.operand.trim() : ''
      const nome = campoId ? nomes.campos?.[campoId] : undefined
      return {
        chave: `condition_campo_${op}`,
        valores: {
          alvo: nome ?? '',
          ...(operadorPedeValor(op) ? { valor: recortar(c.value, 30) } : {}),
        },
        alvoSumiu: !nome,
      }
    }

    case 'create_task':
      // O TÍTULO, não o responsável: é ele que distingue duas tarefas no mesmo
      // quadro ("Conferir documentação" × "Ligar para o cliente"). O nome de
      // quem recebe não cabe em `NomesConhecidos` — a tela da grade não
      // carrega membros — e um id cru ali seria lido como se fosse o nome.
      return simples(recortar((cfg as unknown as CreateTaskStepConfig).titulo))

    // O nó "Atlas" (30/09/2026). O "Atualizar cliente" diz a SITUAÇÃO que
    // escreve (é o que pesa: muda o grupo do cliente no Atlas), por ICU
    // `select` — a lista é fechada e o rótulo é do dicionário. Situação fora
    // da lista (a ativação a recusa) cai no `other`, sem ela.
    case 'atlas_atualizar_cliente': {
      const s = (cfg as unknown as AtlasAtualizarClienteStepConfig).situacao
      return {
        chave: tipo,
        valores: { situacao: typeof s === 'string' && (SITUACOES_ESCREVIVEIS as readonly string[]).includes(s) ? s : 'nenhuma' },
        alvoSumiu: false,
      }
    }
    case 'atlas_criar_tarefa':
      return simples(recortar((cfg as unknown as AtlasCriarTarefaStepConfig).titulo))
    case 'atlas_atualizar_onboarding':
      // O ITEM: é o que distingue dois passos de onboarding no mesmo quadro.
      return simples(recortar((cfg as unknown as AtlasAtualizarOnboardingStepConfig).item))

    default:
      // send_buttons, send_list, assign_conversation, stop_flow,
      // send_webhook, close_conversation — o tipo já diz o suficiente.
      // pin_conversation_channel também: o nome da conexão pediria
      // `nomes.canais`, que nenhuma tela que resume passo carrega — e o id cru
      // ou "(apagado)" sobre conexão viva seriam piores que a frase sem ele.
      // atlas_criar_cliente e atlas_enviar_transcricao também: o tipo já
      // diz o que o passo faz.
      return simples()
  }
}

/** Primeira linha do texto, curta. O cartão tem uma linha, não um parágrafo. */
function recortar(texto: unknown, limite = 40): string {
  const s = typeof texto === 'string' ? texto.trim().split('\n')[0] : ''
  return s.length > limite ? `${s.slice(0, limite - 1)}…` : s
}
