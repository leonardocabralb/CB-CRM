import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { telefoneDigitado } from '@/lib/contacts/telefone'
import { MAX_DESCRICAO, MAX_TITULO, normalizarHora } from '@/lib/tasks/validar'
import { motivoDeConfigInvalida } from './lembretes'
import { lerModoDoResponsavel } from './responsavel-da-tarefa'
import { MAX_POSICOES_DO_MODELO } from './parametros-do-modelo'
import { lerJanela } from './hora-do-dia'
import {
  problemaDaCondicaoPorCampo,
  problemaDaFormaDaCondicao,
  type CampoParaCondicao,
} from './condicao-por-campo'
import { ehGatilhoDaRegua, horaDeEnvioValida } from '@/lib/asaas/regua'
import { ehMeta, ehWhatsApp } from '@/lib/cb-channels/transporte'
import type { CbChannelKind } from '@/lib/cb-channels/repo'
import { TIPOS_DE_CONTRATO } from '@/lib/atlas/formatar'
import { ehIdDeFunil, SITUACOES_DO_GATILHO } from '@/lib/atlas/gatilho'
import {
  IDADE_MAXIMA_DA_TRANSCRICAO_H,
  PRAZO_MAXIMO_DA_TAREFA,
  PRIORIDADES_DA_TAREFA,
  SITUACOES_DO_ONBOARDING,
  SITUACOES_ESCREVIVEIS,
} from '@/lib/atlas/passos-do-atlas'
import { GATILHO_DO_ATLAS } from './so-pelo-disparador'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
  /**
   * NOSSO: o motivo em código estável, para a TELA escrever a frase no idioma
   * do app (`Automations.builder.pendencias.codigos.<codigo>`, via
   * `chaveDaPendencia` de `pendencias.ts`). O `message` continua em inglês e
   * é CONTRATO — a API o devolve no 400 —, e por isso nenhum dos dois muda:
   * só se acrescenta. Ausente nas mensagens que já nascem em português (escopo
   * de canal, janela da Meta, condição por campo): a tela mostra o `message`.
   *
   * ⚠️ Sempre um texto LITERAL no próprio `push`, nunca montado nem num
   * ternário: o teste de `pendencias.test.ts` colhe os literais deste arquivo
   * e cobra a frase nos dois dicionários (e a lista `CODIGOS_DE_PENDENCIA`) —
   * chave montada escapa do portão de i18n do CI. Por isso há `case` e `push`
   * separados onde a regra é a mesma e só o conserto muda.
   */
  codigo?: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
      codigo: 'sem_passos',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'move_deal_stage':
      // A etapa é obrigatória: sem ela o passo não sabe para onde mover, e o
      // motor estouraria em execução — o tipo de falha que esta validação
      // existe para antecipar.
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required', codigo: 'mover_card_sem_etapa' })
      }
      break
    case 'set_deal_status':
      if (c.status !== 'won' && c.status !== 'lost' && c.status !== 'open') {
        issues.push({
          path: `${path}.status`,
          message: 'status must be "won", "lost" or "open"',
          codigo: 'status_do_negocio_invalido',
        })
      }
      break
    // Orquestração (936). Os três exigem o alvo pelo mesmo motivo do
    // `move_deal_stage`: sem ele o passo não sabe o que acionar/parar, e a
    // falha só apareceria em execução, no log, longe de quem montou.
    //
    // ⚠️ NÃO se valida aqui se o alvo existe, é da conta ou está ativo. Isso
    // é estado do banco no momento do DISPARO, não do save: a automação alvo
    // pode ser desativada depois, e uma validação que passou ontem afirmaria
    // hoje uma coisa falsa. O motor confere na hora, e a tela avisa enquanto
    // se edita.
    //
    // Os dois `case` são SEPARADOS (a regra é a mesma) só para cada um levar o
    // seu código literal — "qual automação acionar" e "qual parar" são frases
    // diferentes para quem vai consertar.
    case 'run_automation':
      if (!nonEmpty(c.automation_id)) {
        issues.push({ path: `${path}.automation_id`, message: 'automation is required', codigo: 'acionar_sem_automacao' })
      }
      break
    case 'stop_automation':
      if (!nonEmpty(c.automation_id)) {
        issues.push({ path: `${path}.automation_id`, message: 'automation is required', codigo: 'parar_sem_automacao' })
      }
      break
    case 'run_flow':
      if (!nonEmpty(c.flow_id)) {
        issues.push({ path: `${path}.flow_id`, message: 'flow is required', codigo: 'iniciar_robo_sem_robo' })
      }
      break
    case 'stop_flow':
      // Sem config: para o robô que estiver rodando com o contato, qualquer
      // que seja. Só existe uma run ativa por contato, então não há o que
      // escolher.
      break
    case 'set_ai':
      // `enabled` é booleano e a tela sempre manda um dos dois. Um valor
      // ausente ou de outro tipo viraria "desligar" em silêncio (o motor lê
      // `!cfg.enabled`), que é o oposto do padrão do passo recém-criado.
      if (typeof c.enabled !== 'boolean') {
        issues.push({ path: `${path}.enabled`, message: 'enabled must be true or false', codigo: 'ia_sem_escolha' })
      }
      break
    case 'send_media': {
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'a file is required', codigo: 'midia_sem_arquivo' })
      }
      const tipos = ['image', 'video', 'document', 'audio']
      if (typeof c.kind !== 'string' || !tipos.includes(c.kind)) {
        issues.push({ path: `${path}.kind`, message: 'kind must be image, video, document or audio', codigo: 'midia_tipo_invalido' })
      }
      // ⚠️ ÁUDIO COM LEGENDA É RECUSADO, e não é preciosismo. A nota de voz sai
      // por `sendWhatsAppAudio`, que não tem campo de legenda: o texto seria
      // gravado na mensagem, apareceria no fio para a EQUIPE e não chegaria ao
      // cliente. Barrar aqui é a diferença entre o operador descobrir agora,
      // montando a regra, e descobrir depois de o cliente dizer que não
      // recebeu.
      if (c.kind === 'audio' && nonEmpty(c.caption)) {
        issues.push({
          path: `${path}.caption`,
          message: 'audio has no caption — WhatsApp voice notes cannot carry text',
          codigo: 'audio_com_legenda',
        })
      }
      // Teto do WhatsApp. A assinatura automática ainda entra por cima no
      // envio, então o núcleo revalida — isto só evita o erro óbvio.
      if (typeof c.caption === 'string' && c.caption.length > 1024) {
        issues.push({ path: `${path}.caption`, message: 'caption is longer than 1024 characters', codigo: 'legenda_longa' })
      }
      break
    }
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required', codigo: 'mensagem_sem_texto' })
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // The whole step_config IS the interactive payload; validate it
      // against Meta's limits (same check the engine runs before send).
      // O detalhe (qual limite, qual botão) a própria caixa da interativa já
      // mostra, no idioma do app (`mensagemDaInterativa`); o código aqui só
      // aponta o passo.
      const result = validateInteractivePayload(c)
      if (!result.ok) {
        issues.push({ path: `${path}.interactive`, message: result.error, codigo: 'interativa_invalida' })
      }
      break
    }
    case 'send_template': {
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required', codigo: 'modelo_nao_escolhido' })
      }
      // Os valores do modelo (Fase 2.3 do plano do previdenciário). O CORPO é
      // POSICIONAL e o motor ignora chave que não é posição — aceitá-la aqui
      // deixaria o operador achar que preencheu um `{{nome}}` que não sai.
      // Quantas variáveis o modelo PEDE só se sabe no envio (a linha depende
      // do canal de saída); lá, faltar valor é falha com o motivo escrito.
      for (const campo of ['variables', 'variaveis_reserva'] as const) {
        const mapa = c[campo]
        if (mapa === undefined || mapa === null) continue
        if (typeof mapa !== 'object' || Array.isArray(mapa)) {
          issues.push({ path: `${path}.${campo}`, message: `${campo} must be an object`, codigo: 'modelo_valores_invalidos' })
          continue
        }
        for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
          if (!/^[1-9]\d*$/.test(k)) {
            issues.push({
              path: `${path}.${campo}`,
              message: `template variable keys must be positions (1, 2, …), got "${k}"`,
              codigo: 'modelo_valor_fora_de_posicao',
            })
          } else if (Number(k) > MAX_POSICOES_DO_MODELO) {
            // O motor ignora acima do teto (um laço por posição); aceitar aqui
            // deixaria o operador achar que preencheu uma variável que não sai.
            issues.push({
              path: `${path}.${campo}`,
              message: `template variable positions go up to ${MAX_POSICOES_DO_MODELO}, got "${k}"`,
              codigo: 'modelo_posicao_acima_do_teto',
            })
          } else if (typeof v !== 'string') {
            issues.push({ path: `${path}.${campo}.${k}`, message: 'template variable values must be text', codigo: 'modelo_valor_sem_texto' })
          }
        }
      }
      const bp = c.button_params
      if (bp !== undefined && bp !== null) {
        if (typeof bp !== 'object' || Array.isArray(bp)) {
          issues.push({ path: `${path}.button_params`, message: 'button_params must be an object', codigo: 'modelo_botoes_invalidos' })
        } else if (
          Object.entries(bp as Record<string, unknown>).some(
            ([k, v]) => !/^\d$/.test(k) || typeof v !== 'string'
          )
        ) {
          // Um modelo tem no máximo 10 botões: posição de 0 a 9.
          issues.push({
            path: `${path}.button_params`,
            message: 'button_params keys must be button positions (0 to 9) and values text',
            codigo: 'modelo_botoes_invalidos',
          })
        }
      }
      // Presente e não-texto (número, booleano, objeto — pela API) é recusado:
      // o motor o converteria em texto e mandaria "123" como link à Meta, e
      // toda execução falharia (Codex, PR #315).
      if (
        c.header_media_url !== undefined &&
        c.header_media_url !== null &&
        typeof c.header_media_url !== 'string'
      ) {
        issues.push({ path: `${path}.header_media_url`, message: 'header file must be text (an http or https address)', codigo: 'modelo_cabecalho_invalido' })
      } else if (nonEmpty(c.header_media_url)) {
        try {
          const u = new URL(String(c.header_media_url))
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            issues.push({ path: `${path}.header_media_url`, message: 'header file must be an http or https address', codigo: 'modelo_cabecalho_invalido' })
          }
        } catch {
          issues.push({ path: `${path}.header_media_url`, message: 'header file is not a valid address', codigo: 'modelo_cabecalho_invalido' })
        }
      }
      break
    }
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required', codigo: 'etiqueta_nao_escolhida' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
          codigo: 'atribuir_sem_atendente',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required', codigo: 'campo_nao_escolhido' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required', codigo: 'campo_sem_valor' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required', codigo: 'criar_card_sem_funil' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required', codigo: 'criar_card_sem_etapa' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'title is required', codigo: 'criar_card_sem_titulo' })
      }
      break
    case 'wait':
      // Ausente = "por um tempo", o de sempre (toda espera já gravada).
      if (c.modo !== undefined && c.modo !== 'tempo' && c.modo !== 'horario') {
        issues.push({ path: `${path}.modo`, message: 'wait modo must be "tempo" or "horario"', codigo: 'espera_modo_invalido' })
      }
      if (c.modo === 'horario') {
        // "Aguardar até estar dentro do horário": a janela é a mesma da
        // condição "Hora do dia". O motor FALHA o passo com a janela que não
        // lê — a automação ficaria ligada parando toda execução ali. Início
        // igual ao fim é janela vazia (recusada por `lerJanela`); o dia
        // inteiro ("00:00-24:00") passa. `amount`/`unit` são ignorados aqui.
        if (!lerJanela(c.janela)) {
          issues.push({
            path: `${path}.janela`,
            message: 'wait window must be "HH:mm-HH:mm" with different start and end',
            codigo: 'espera_janela_invalida',
          })
        }
      } else {
        if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
          issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0', codigo: 'espera_sem_tempo' })
        }
        if (!['seconds', 'minutes', 'hours', 'days'].includes(String(c.unit))) {
          issues.push({
            path: `${path}.unit`,
            message: 'wait unit must be seconds, minutes, hours, or days',
            codigo: 'espera_unidade_invalida',
          })
        }
      }
      // Só booleano, como a caixa da condição: `"true"` seria uma caixa
      // marcada na tela que o motor ignora (esperaria também no sábado).
      if (c.somente_seg_a_sex !== undefined && typeof c.somente_seg_a_sex !== 'boolean') {
        issues.push({
          path: `${path}.somente_seg_a_sex`,
          message: 'wait somente_seg_a_sex must be true or false',
          codigo: 'espera_dias_uteis_invalido',
        })
      }
      // ⚠️ Só booleano. O motor liga a opção apenas com `true` estrito, então
      // um `"true"` gravado aqui seria uma caixa que a tela mostra marcada
      // (truthy) e o motor ignora — a sequência seguiria depois da resposta
      // do cliente com o operador achando que ela para.
      if (c.parar_se_responder !== undefined && typeof c.parar_se_responder !== 'boolean') {
        issues.push({
          path: `${path}.parar_se_responder`,
          message: 'wait parar_se_responder must be true or false',
          codigo: 'espera_parar_se_responder_invalido',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'condition subject is required', codigo: 'condicao_sem_criterio' })
      }
      // A janela de 24h (Fase 2.8) é a ÚNICA sem operando obrigatório: vazio
      // = o número da próxima mensagem (o do disparo, senão o da conversa).
      if (c.subject === 'custom_field' && !nonEmpty(c.operand)) {
        issues.push({
          path: `${path}.operand`,
          message: 'A condição "Campo personalizado da ficha" precisa do campo — escolha um.',
        })
      } else if (c.subject === 'message_content') {
        // ⚠️ "O conteúdo da mensagem contém" é o `value`, e o operando NÃO é
        // lido: o motor faz `texto.includes(value)` e ignora `operand`. Até
        // 29/09/2026 esta regra exigia o operando — por isso há automações em
        // produção com "contém" digitado à mão no operando — e deixava passar
        // o `value` vazio, que é o perigo de verdade: `includes('')` é
        // verdadeiro para TODA mensagem, e a condição responderia "sim" a
        // qualquer coisa que o cliente escrevesse. Medido antes de mudar: as
        // duas automações ligadas com este critério têm o `value` preenchido.
        if (!nonEmpty(c.value)) {
          issues.push({ path: `${path}.value`, message: 'condition text is required', codigo: 'condicao_sem_texto' })
        }
      } else if (c.subject !== 'meta_window_open' && !nonEmpty(c.operand)) {
        // Um código por critério: a frase na tela diz O QUE escolher ("Escolha
        // a etiqueta"), não um genérico. Mesmo path e message para todos.
        const semOperando = { path: `${path}.operand`, message: 'condition operand is required' }
        if (c.subject === 'tag_presence') issues.push({ ...semOperando, codigo: 'condicao_sem_etiqueta' })
        else if (c.subject === 'contact_field') issues.push({ ...semOperando, codigo: 'condicao_sem_campo_do_contato' })
        else if (c.subject === 'deal_stage') issues.push({ ...semOperando, codigo: 'condicao_sem_etapa' })
        else if (c.subject === 'deal_status') issues.push({ ...semOperando, codigo: 'condicao_sem_status' })
        else if (c.subject === 'channel') issues.push({ ...semOperando, codigo: 'condicao_sem_conexao' })
        else issues.push({ ...semOperando, codigo: 'condicao_sem_valor' })
      } else if (c.subject === 'time_of_day' && !lerJanela(c.operand)) {
        // O motor responde "não" SEMPRE para janela que não lê — a automação
        // ficaria ligada com um ramo morto, sem nada dizendo por quê.
        issues.push({
          path: `${path}.operand`,
          message: 'time of day must be "HH:mm-HH:mm" with different start and end',
          codigo: 'condicao_horario_invalido',
        })
      }
      if (c.somente_seg_a_sex !== undefined && typeof c.somente_seg_a_sex !== 'boolean') {
        issues.push({
          path: `${path}.somente_seg_a_sex`,
          message: 'condition somente_seg_a_sex must be true or false',
          codigo: 'condicao_dias_uteis_invalido',
        })
      }
      // Campo personalizado (2.10): aqui só a FORMA (operador conhecido e,
      // para "é"/"contém", um valor). Que o campo existe NESTA conta e aceita
      // o operador é da rota, com o banco (`validateCustomFieldConditionsForActivation`).
      if (c.subject === 'custom_field') {
        const forma = problemaDaFormaDaCondicao(c)
        if (forma) issues.push({ path: `${path}.operator`, message: forma })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required', codigo: 'webhook_sem_endereco' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
            codigo: 'webhook_endereco_invalido',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL', codigo: 'webhook_endereco_invalido' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    case 'pin_conversation_channel':
      // Sem conexão o passo não sabe em qual número fixar, e o motor
      // estouraria em execução. Que ela existe e é de WhatsApp é conferido com
      // as conexões da conta, em `validateChannelScopeForActivation`.
      if (!nonEmpty(c.channel_id)) {
        issues.push({ path: `${path}.channel_id`, message: 'connection is required', codigo: 'fixar_sem_conexao' })
      }
      break
    case 'atlas_criar_cliente':
      // Só a FORMA: nada é obrigatório (sem campo de data, o Atlas recebe as
      // reservas de sempre). Que o Atlas está conectado é do motor, na hora —
      // a conexão pode cair depois de a automação ser ligada.
      if (
        c.tipo_de_contrato !== undefined &&
        c.tipo_de_contrato !== null &&
        !(TIPOS_DE_CONTRATO as readonly unknown[]).includes(c.tipo_de_contrato)
      ) {
        issues.push({
          path: `${path}.tipo_de_contrato`,
          message: 'contract type must be "fixo" or "mensal"',
          codigo: 'atlas_tipo_de_contrato_invalido',
        })
      }
      for (const campo of ['campo_primeiro_contato', 'campo_proposta', 'campo_fechamento'] as const) {
        const v = c[campo]
        if (v !== undefined && v !== null && typeof v !== 'string') {
          issues.push({
            path: `${path}.${campo}`,
            message: 'date field must be a custom field key or empty',
            codigo: 'atlas_campo_invalido',
          })
        }
      }
      break
    // O nó "Atlas" (30/09/2026): só a FORMA. Conexão, vínculo e permissões
    // são do motor, na hora (podem mudar depois de a automação ser ligada).
    case 'atlas_atualizar_cliente': {
      if (c.situacao !== undefined && c.situacao !== null && !(SITUACOES_ESCREVIVEIS as readonly unknown[]).includes(c.situacao)) {
        issues.push({
          path: `${path}.situacao`,
          message: `Atlas status must be one of: ${SITUACOES_ESCREVIVEIS.join(', ')} (or empty)`,
          codigo: 'atlas_situacao_invalida',
        })
      }
      if (
        c.tipo_de_contrato !== undefined &&
        c.tipo_de_contrato !== null &&
        !(TIPOS_DE_CONTRATO as readonly unknown[]).includes(c.tipo_de_contrato)
      ) {
        issues.push({
          path: `${path}.tipo_de_contrato`,
          message: 'contract type must be "fixo" or "mensal" (or empty)',
          codigo: 'atlas_tipo_de_contrato_invalido',
        })
      }
      const camposDoAtualizar = ['campo_primeiro_contato', 'campo_proposta', 'campo_fechamento', 'campo_documento'] as const
      for (const campo of camposDoAtualizar) {
        const v = c[campo]
        if (v !== undefined && v !== null && typeof v !== 'string') {
          issues.push({
            path: `${path}.${campo}`,
            message: 'field must be a custom field key or empty',
            codigo: 'atlas_campo_invalido',
          })
        }
      }
      // Booleano de JSONB liga só com `true` (CLAUDE.md 8c).
      const algum =
        nonEmpty(c.situacao) ||
        nonEmpty(c.tipo_de_contrato) ||
        c.valor_do_card === true ||
        c.link_da_conversa === true ||
        c.telefone === true ||
        c.email === true ||
        camposDoAtualizar.some((campo) => nonEmpty(c[campo]))
      if (!algum) {
        issues.push({ path: `${path}`, message: 'choose at least one field to update in Atlas', codigo: 'atlas_atualizar_sem_campos' })
      }
      break
    }
    case 'atlas_criar_tarefa':
      if (!nonEmpty(c.titulo)) {
        issues.push({ path: `${path}.titulo`, message: 'task title is required', codigo: 'atlas_tarefa_sem_titulo' })
      }
      if (c.prioridade !== undefined && !(PRIORIDADES_DA_TAREFA as readonly unknown[]).includes(c.prioridade)) {
        issues.push({ path: `${path}.prioridade`, message: 'priority must be "normal" or "urgent"', codigo: 'atlas_tarefa_prioridade_invalida' })
      }
      if (
        c.prazo_em_dias !== undefined &&
        c.prazo_em_dias !== null &&
        !(Number.isInteger(c.prazo_em_dias) && (c.prazo_em_dias as number) >= 0 && (c.prazo_em_dias as number) <= PRAZO_MAXIMO_DA_TAREFA)
      ) {
        issues.push({
          path: `${path}.prazo_em_dias`,
          message: `due date must be a whole number of days from 0 to ${PRAZO_MAXIMO_DA_TAREFA} (or empty)`,
          codigo: 'atlas_tarefa_prazo_invalido',
        })
      }
      break
    case 'atlas_enviar_transcricao':
      if (
        c.idade_maxima_horas !== undefined &&
        !(Number.isInteger(c.idade_maxima_horas) && (c.idade_maxima_horas as number) >= 1 && (c.idade_maxima_horas as number) <= IDADE_MAXIMA_DA_TRANSCRICAO_H)
      ) {
        issues.push({
          path: `${path}.idade_maxima_horas`,
          message: `transcript window must be a whole number of hours from 1 to ${IDADE_MAXIMA_DA_TRANSCRICAO_H}`,
          codigo: 'atlas_transcricao_idade_invalida',
        })
      }
      if (c.incluir_notas_da_reuniao !== undefined && typeof c.incluir_notas_da_reuniao !== 'boolean') {
        issues.push({
          path: `${path}.incluir_notas_da_reuniao`,
          message: 'incluir_notas_da_reuniao must be true or false',
          codigo: 'atlas_transcricao_notas_invalido',
        })
      }
      if (c.aceitar_vinculo_por_email !== undefined && typeof c.aceitar_vinculo_por_email !== 'boolean') {
        issues.push({
          path: `${path}.aceitar_vinculo_por_email`,
          message: 'aceitar_vinculo_por_email must be true or false',
          codigo: 'atlas_transcricao_email_invalido',
        })
      }
      break
    case 'atlas_atualizar_onboarding': {
      const item = typeof c.item === 'string' ? c.item.trim() : ''
      if (!item) {
        issues.push({ path: `${path}.item`, message: 'onboarding checklist item is required', codigo: 'atlas_onboarding_sem_item' })
      } else if (item.includes('{{')) {
        // O item é IDENTIDADE (o Atlas casa pelo texto): não aceita variável.
        issues.push({
          path: `${path}.item`,
          message: 'onboarding checklist item must be literal text (no variables)',
          codigo: 'atlas_onboarding_item_com_variavel',
        })
      }
      const semSituacao = c.situacao === undefined || c.situacao === null
      if (!semSituacao && !(SITUACOES_DO_ONBOARDING as readonly unknown[]).includes(c.situacao)) {
        issues.push({
          path: `${path}.situacao`,
          message: `onboarding item status must be one of: ${SITUACOES_DO_ONBOARDING.join(', ')} (or empty)`,
          codigo: 'atlas_onboarding_situacao_invalida',
        })
      }
      if (semSituacao && !nonEmpty(c.observacao)) {
        issues.push({
          path: `${path}.observacao`,
          message: 'choose the item status or write an observation',
          codigo: 'atlas_onboarding_sem_mudanca',
        })
      }
      break
    }
    case 'send_to_number': {
      // O número que o OPERADOR digita no construtor passa pela régua das
      // telas (`telefoneDigitado`, a mesma do motor desde a Fase 3-III):
      // "(83) 98000-0016" ganha o 55, e "98000-0016" (sem DDD) é recusado
      // aqui, com o motivo — pela régua dos sistemas ele passava e o aviso ao
      // advogado saía para +98. Sem telefone o passo não tem destinatário, e o
      // motor estouraria em execução — o tipo de falha que esta validação
      // existe para pegar antes de ativar.
      //
      // Um `push` por motivo (e não um ternário no `message`) para cada um
      // levar o SEU código literal.
      const telefone = telefoneDigitado(typeof c.phone === 'string' ? c.phone : '')
      if (!telefone.ok) {
        if (telefone.motivo === 'vazio') {
          issues.push({ path: `${path}.phone`, message: 'phone is required', codigo: 'numero_sem_telefone' })
        } else if (telefone.motivo === 'curto') {
          issues.push({
            path: `${path}.phone`,
            message: 'phone is too short (missing the area code?)',
            codigo: 'numero_telefone_curto',
          })
        } else {
          issues.push({
            path: `${path}.phone`,
            message:
              'phone is not a valid number (Brazilian: with the area code; other countries: with + and the country code)',
            codigo: 'numero_telefone_invalido',
          })
        }
      }
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required', codigo: 'mensagem_sem_texto' })
      }
      break
    }
    case 'create_task': {
      if (!nonEmpty(c.titulo)) {
        issues.push({ path: `${path}.titulo`, message: 'task title is required', codigo: 'tarefa_sem_titulo' })
      } else if (String(c.titulo).trim().length > MAX_TITULO) {
        issues.push({ path: `${path}.titulo`, message: `task title must be at most ${MAX_TITULO} chars`, codigo: 'tarefa_titulo_longo' })
      }
      // ⚠️ Sem responsável a tarefa não tem para quem ir, e o motor estouraria
      // em execução — o tipo de falha que esta validação existe para pegar
      // antes de a automação ser ativada. Se ela é MEMBRO da conta é o motor
      // que confere: a lista de membros muda depois de a regra ser gravada.
      // Nos modos "responsável pela conversa/pelo card" (Fase 2.4), o fixo
      // vira a RESERVA — e continua OBRIGATÓRIO: sem ninguém atribuído (o caso
      // comum; medido em 26/09/2026, nenhum card da conta tem responsável) o
      // passo falharia na execução e pararia as mensagens seguintes ao
      // cliente. Ver `responsavel-da-tarefa.ts`.
      const modo = lerModoDoResponsavel(c.responsavel_modo)
      if (!modo) {
        issues.push({
          path: `${path}.responsavel_modo`,
          message: 'task assignee mode must be "fixo", "conversa" or "card"',
          codigo: 'tarefa_modo_invalido',
        })
      } else if (!nonEmpty(c.responsavel_user_id)) {
        // Um `push` por modo, cada um com o seu código literal: "escolha o
        // responsável" e "escolha a pessoa de reserva" são consertos que a
        // tela precisa dizer de jeitos diferentes.
        if (modo === 'fixo') {
          issues.push({
            path: `${path}.responsavel_user_id`,
            message: 'task assignee is required',
            codigo: 'tarefa_sem_responsavel',
          })
        } else {
          issues.push({
            path: `${path}.responsavel_user_id`,
            message: 'a fallback assignee is required: the task goes to them when no one is assigned',
            codigo: 'tarefa_sem_reserva',
          })
        }
      }
      // Mesmo teto do motor e da rota de tarefas. Sem isto a automação ativa
      // com uma descrição longa demais e falha em TODA execução — o passo
      // estoura em `normalizarDescricao` e a tarefa nunca é criada, que é
      // exatamente o que esta validação existe para pegar antes (Codex, #152).
      if (typeof c.descricao === 'string' && c.descricao.trim().length > MAX_DESCRICAO) {
        issues.push({
          path: `${path}.descricao`,
          message: `task description must be at most ${MAX_DESCRICAO} chars`,
          codigo: 'tarefa_descricao_longa',
        })
      }
      if (c.prazo_em_dias !== undefined && c.prazo_em_dias !== null) {
        const dias = Number(c.prazo_em_dias)
        if (!Number.isFinite(dias) || dias < 0 || dias > 365) {
          issues.push({ path: `${path}.prazo_em_dias`, message: 'due date must be 0–365 days from today', codigo: 'tarefa_prazo_invalido' })
        }
      }
      if (nonEmpty(c.hora) && normalizarHora(c.hora) === undefined) {
        issues.push({ path: `${path}.hora`, message: 'time must be HH:MM', codigo: 'tarefa_hora_invalida' })
      }
      break
    }
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}`, codigo: 'passo_desconhecido' })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required', codigo: 'gatilho_sem_palavras' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings', codigo: 'gatilho_palavra_vazia' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (
      cfg.match_type != null &&
      cfg.match_type !== 'exact' &&
      cfg.match_type !== 'contains' &&
      cfg.match_type !== 'word'
    ) {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact", "contains" or "word"',
        codigo: 'gatilho_tipo_de_busca_invalido',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required', codigo: 'gatilho_sem_agenda' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required', codigo: 'gatilho_sem_etiqueta' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'at least one reply id is required',
        codigo: 'gatilho_sem_respostas',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'reply ids cannot be empty strings',
        codigo: 'gatilho_resposta_vazia',
      })
    }
  } else if (triggerType === 'deal_stage_changed') {
    // ⚠️ NÃO exige etapa: vazio significa "qualquer etapa", que é uma regra
    // legítima ("toda vez que um card se mexer, avise o responsável") e a
    // convenção do projeto para escopo vazio. Só o lixo é recusado — string
    // vazia é o que um seletor mal resetado grava, e ela nunca casaria com
    // etapa nenhuma, deixando a automação ativa e muda.
    const ids = cfg.stage_ids
    if (ids != null && !Array.isArray(ids)) {
      issues.push({ path: 'trigger.stage_ids', message: 'stage_ids must be a list', codigo: 'gatilho_etapas_invalidas' })
    } else if (
      Array.isArray(ids) &&
      ids.some((v) => typeof v !== 'string' || v.trim() === '')
    ) {
      issues.push({
        path: 'trigger.stage_ids',
        message: 'stage ids cannot be empty strings',
        codigo: 'gatilho_etapas_invalidas',
      })
    }
    // ⚠️ Só booleano: o motor prende a automação à etapa apenas com `true`
    // estrito, e um `"true"` gravado seria opção que parece ligada e não age.
    if (cfg.parar_ao_sair !== undefined && typeof cfg.parar_ao_sair !== 'boolean') {
      issues.push({
        path: 'trigger.parar_ao_sair',
        message: 'parar_ao_sair must be true or false',
        codigo: 'gatilho_parar_ao_sair_invalido',
      })
    }
  } else if (triggerType === 'date_field_offset') {
    // ⚠️ Aqui a config é OBRIGATÓRIA, ao contrário dos gatilhos de funil.
    // Lá, vazio quer dizer "qualquer etapa" — uma regra legítima. Aqui, sem
    // campo de data não existe nem alvo nem instante: a automação ficaria
    // ativa e muda para sempre.
    const motivo = motivoDeConfigInvalida(cfg as never)
    if (motivo) {
      issues.push({ path: 'trigger.custom_field_id', message: motivo })
    }
  } else if (triggerType === 'calendly_booking') {
    // Vazio = qualquer evento (convenção do projeto). Só o lixo é recusado:
    // `event_type_uri` que não seja texto nunca casaria com evento nenhum e
    // deixaria a automação ativa e muda.
    const uri = cfg.event_type_uri
    if (uri != null && typeof uri !== 'string') {
      issues.push({ path: 'trigger.event_type_uri', message: 'event type must be a string', codigo: 'gatilho_evento_invalido' })
    }
    // Só booleano: `"true"` seria uma caixa marcada na tela que o motor ignora.
    if (cfg.ignorar_reagendamento != null && typeof cfg.ignorar_reagendamento !== 'boolean') {
      issues.push({ path: 'trigger.ignorar_reagendamento', message: 'ignore reschedules must be true or false', codigo: 'gatilho_reagendamento_invalido' })
    }
  } else if (triggerType === 'webhook_received') {
    // Vazio = qualquer webhook de entrada da conta (convenção do projeto).
    // Só o lixo é recusado: um `webhook_id` que não seja texto nunca casaria
    // com acionamento nenhum e deixaria a automação ativa e muda.
    const id = cfg.webhook_id
    if (id != null && typeof id !== 'string') {
      issues.push({ path: 'trigger.webhook_id', message: 'webhook must be a string', codigo: 'gatilho_webhook_invalido' })
    }
  } else if (ehGatilhoDaRegua(triggerType)) {
    // A régua do Asaas (998). O marco é OBRIGATÓRIO na cobrança: sem ele a
    // automação ficaria ativa e muda. A hora fica na faixa que a varredura
    // aceita (08:00–17:00; a mensagem sai até as 18:00), e o sinalizador de
    // dia útil tem de ser booleano — `"false"` é truthy.
    if (triggerType === 'asaas_cobranca_vencida') {
      const dias = Number(cfg.dias_de_atraso)
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
        issues.push({ path: 'trigger.dias_de_atraso', message: 'days overdue must be a whole number from 1 to 365', codigo: 'gatilho_dias_de_atraso_invalido' })
      }
    }
    if (cfg.hora_envio != null && cfg.hora_envio !== '' && !horaDeEnvioValida(cfg.hora_envio)) {
      issues.push({ path: 'trigger.hora_envio', message: 'send time must be HH:MM between 08:00 and 17:00', codigo: 'gatilho_hora_de_envio_invalida' })
    }
    if (cfg.somente_dias_uteis != null && typeof cfg.somente_dias_uteis !== 'boolean') {
      issues.push({ path: 'trigger.somente_dias_uteis', message: 'business days only must be true or false', codigo: 'gatilho_dias_uteis_invalido' })
    }
  } else if (triggerType === GATILHO_DO_ATLAS) {
    // NOSSO (1073): "Situação mudou no Atlas". As situações são obrigatórias
    // (sem elas nada dispara) e da lista do contrato; o FUNIL também — o
    // disparo leva sempre o card do evento, e sem funil não há card
    // (decisão do operador, 30/09/2026).
    const sit = cfg.situacoes
    if (!Array.isArray(sit) || sit.length === 0) {
      issues.push({ path: 'trigger.situacoes', message: 'choose at least one Atlas status', codigo: 'gatilho_atlas_sem_situacao' })
    } else if (sit.some((v) => typeof v !== 'string' || !(SITUACOES_DO_GATILHO as readonly string[]).includes(v))) {
      issues.push({ path: 'trigger.situacoes', message: `Atlas status must be one of: ${SITUACOES_DO_GATILHO.join(', ')}`, codigo: 'gatilho_atlas_situacao_invalida' })
    }
    // Id de funil malformado (só por chamada direta à API: o construtor lista
    // os funis) derrubaria a busca dos cards de TODAS as automações do gatilho.
    const funis = cfg.pipeline_ids
    if (!Array.isArray(funis) || funis.length === 0 || funis.some((v) => !ehIdDeFunil(v))) {
      issues.push({ path: 'trigger.pipeline_ids', message: 'choose at least one pipeline (valid ids) where the client card must be', codigo: 'gatilho_atlas_sem_funil' })
    }
  } else if (triggerType === 'deal_status_changed') {
    const st = cfg.statuses
    if (st != null && !Array.isArray(st)) {
      issues.push({ path: 'trigger.statuses', message: 'statuses must be a list', codigo: 'gatilho_status_invalidos' })
    } else if (
      Array.isArray(st) &&
      st.some((v) => v !== 'won' && v !== 'lost' && v !== 'open')
    ) {
      issues.push({
        path: 'trigger.statuses',
        message: 'status must be "won", "lost" or "open"',
        codigo: 'gatilho_status_invalidos',
      })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * As regras a MAIS dos passos das automações da régua do Asaas (998), além
 * de `validateStepsForActivation`:
 *
 * - NENHUM "Aguardar", em nenhum escopo: a espera retoma às cegas (só confere
 *   se a automação continua ligada) e sairia sem reconfirmar o pagamento —
 *   `[mensagem][aguardar 4 dias][mensagem]` mandaria a de 5 dias a quem
 *   pagou no dia 2. Cada marco é uma automação própria (§2.4 do plano).
 * - NENHUM "Acionar automação"/"Iniciar robô", em nenhum escopo: a entrega
 *   por eles não conta como envio na trava, e a filha pode esperar.
 * - NENHUM modelo, botões ou lista, em nenhum escopo: só saem pela Meta, e a
 *   régua sai por conexão de QR Code (a varredura exige isso).
 * - TODO `send_message` com a conexão escolhida (`channel_id`, D19): a
 *   varredura confere que ela resolve e está viva ANTES de travar, e o
 *   motor falha fechado se não resolver — sem conexão escolhida a
 *   automação não liga, porque o padrão da conta em silêncio seria o link
 *   de pagamento saindo por outro número.
 */
export function validateAsaasReguaForActivation(
  triggerType: AutomationTriggerType | string,
  steps: StepLike[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!ehGatilhoDaRegua(triggerType)) return issues
  // ⚠️ UMA conexão para TODOS os envios da automação (D19): a varredura
  // resolve e confere a saúde da conexão do PRIMEIRO `send_message` e a
  // passa em `context.channel_id`; um segundo envio apontado para outra
  // conexão sairia por um número que ninguém conferiu (revisão adversarial
  // do PR #206). `send_media` entra na mesma regra — a mídia também sai
  // pelo canal do passo.
  let conexao: string | null = null
  // ⚠️ Pelo menos UM `send_message`: é dele que a varredura resolve a conexão
  // (`primeiroEnvio`). O `enviado` da trava vem de QUALQUER passo que entrega
  // ao contato (`PASSOS_QUE_FALAM_COM_O_CONTATO`, em asaas/regua.ts). Uma
  // automação só com `send_media` (ou sem envio) ativava e era pulada em
  // todo ciclo como "conexão inválida" (Codex, 3ª rodada do PR #206).
  let temMensagem = false
  const visitar = (lista: StepLike[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`
      // Inclusive o "até estar dentro do horário" (26/09/2026): ele também
      // retoma às cegas, sem reconfirmar o pagamento. A janela da régua é a
      // dela (`hora_envio` até 18:00), conferida pela varredura.
      if (s.step_type === 'wait') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence cannot wait — each milestone is its own automation', codigo: 'regua_com_espera' })
      }
      // ⚠️ Nem "Acionar automação" nem "Iniciar robô", em nenhum escopo: a
      // mensagem que sai pela FILHA fica no log dela, e o log da régua fecha
      // só com `run_automation: success` → a trava vira `barrada` e o cliente
      // cobrado fica fora do intervalo mínimo; pior, a filha comum pode ter um
      // "Aguardar" e retomar dias depois sem reconfirmar o pagamento, e a
      // cerca de conexão do motor olha o gatilho da FILHA — a proibição do
      // "Aguardar" e a D19 ficavam dribladas por um passo (revisão da 4ª
      // rodada do PR #206). Parar (`stop_*`) segue permitido: não entrega nada.
      if (s.step_type === 'run_automation' || s.step_type === 'run_flow') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence cannot run another automation or bot — the message must be sent by this automation', codigo: 'regua_aciona_outra' })
      }
      // ⚠️ Nem modelo, nem botões, nem lista, em nenhum escopo: só saem pela
      // Meta, e a régua é só QR Code na v1 (o modelo aprovado é Fase 4). Fixado
      // num número oficial, o passo passava em `validateChannelScopeForActivation`
      // e saía por um número que a varredura não sondou (ela confere só o do
      // primeiro `send_message`) e que o motor não cerca (a trava que falha
      // fechado existe só no `send_message`) — o link de pagamento por outro
      // número, que a D19 proíbe. Sem conexão fixada, herdava o QR Code do
      // disparo, falhava sempre e gastava a trava do marco como `falhou`
      // (revisão da 4ª rodada do PR #206).
      if (s.step_type === 'send_template' || s.step_type === 'send_buttons' || s.step_type === 'send_list') {
        issues.push({ path: `${path}.step_type`, message: 'the Asaas collection sequence sends through a QR Code connection — templates, buttons and lists are only available on the official API', codigo: 'regua_so_texto' })
      }
      if (s.step_type === 'send_message') temMensagem = true
      if (s.step_type === 'send_message' || s.step_type === 'send_media') {
        const canal = s.step_config?.channel_id
        if (!nonEmpty(canal)) {
          issues.push({ path: `${path}.channel_id`, message: 'the Asaas collection message needs a connection chosen on the step', codigo: 'regua_sem_conexao' })
        } else if (conexao === null) {
          conexao = canal as string
        } else if (canal !== conexao) {
          issues.push({ path: `${path}.channel_id`, message: 'the Asaas collection sequence must send every message through the same connection', codigo: 'regua_conexao_diferente' })
        }
      }
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) visitar(s.branches.yes, `${path}.yes.`)
        if (s.branches.no) visitar(s.branches.no, `${path}.no.`)
      }
    })
  }
  visitar(steps, '')
  if (!temMensagem) {
    issues.push({ path: 'steps', message: 'the Asaas collection sequence needs a text message step (send_message)', codigo: 'regua_sem_mensagem' })
  }
  return issues
}

/**
 * NOSSO (1073) — a regra a MAIS da "Situação mudou no Atlas": nenhum
 * "Criar cliente no Atlas" nem "Atualizar cliente no Atlas" (nó Atlas), em
 * nenhum escopo. O Atlas manda na situação
 * (D2): reativar por reflexo de uma mudança feita lá desfaria a decisão da
 * equipe, e a reativação viraria outra mudança lida no ciclo seguinte.
 * ⚠️ Nem "Acionar automação" (como a régua, `regua_aciona_outra`): a filha
 * roda com o contato do evento e pode ter o "Criar cliente" — e ganhá-lo
 * DEPOIS de esta ser ligada, validada só pelo gatilho dela.
 */
export function validateAtlasSituacaoForActivation(
  triggerType: AutomationTriggerType | string,
  steps: StepLike[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (triggerType !== GATILHO_DO_ATLAS) return issues
  const visitar = (lista: StepLike[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`
      if (s.step_type === 'atlas_criar_cliente') {
        issues.push({ path: `${path}.step_type`, message: 'an automation triggered by an Atlas status change cannot create or reactivate the client in Atlas', codigo: 'atlas_gatilho_com_criar_cliente' })
      }
      // O nó Atlas (30/09/2026): "Atualizar cliente" INTEIRO, com ou sem
      // situação — sem ela ainda grava o cadastro por reflexo e, se alguém
      // escolher a situação depois, vira laço. Tarefa, transcrição e
      // onboarding não mudam a situação e ficam permitidos.
      if (s.step_type === 'atlas_atualizar_cliente') {
        issues.push({ path: `${path}.step_type`, message: 'an automation triggered by an Atlas status change cannot update the client in Atlas', codigo: 'atlas_gatilho_com_atualizar_cliente' })
      }
      if (s.step_type === 'run_automation') {
        issues.push({ path: `${path}.step_type`, message: 'an automation triggered by an Atlas status change cannot run another automation', codigo: 'atlas_gatilho_aciona_outra' })
      }
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) visitar(s.branches.yes, `${path}.yes.`)
        if (s.branches.no) visitar(s.branches.no, `${path}.no.`)
      }
    })
  }
  visitar(Array.isArray(steps) ? steps : [], '')
  return issues
}

// ------------------------------------------------------------
// Multi-canal: passos que só existem na API OFICIAL da Meta.
//
// `send_template`, `send_buttons` e `send_list` não têm equivalente na
// Evolution (Baileys). Antes, o operador montava um menu de botões, ativava
// sem nenhum aviso, e ele funcionava para METADE dos clientes — a tela de
// logs mostrava execuções `failed` alternando com `success`, sem nenhuma
// indicação de que a causa era o número por onde a pessoa escreveu.
//
// Agora a ativação recusa a combinação impossível na hora de salvar.
// ------------------------------------------------------------

/** Passos que exigem um canal Meta (API oficial). */
const META_ONLY_STEPS = new Set(['send_template', 'send_buttons', 'send_list']);

// O nome do passo como o construtor o mostra. Estas mensagens aparecem em
// vermelho no cartão e no painel de pendências (29/09/2026), e o tipo cru
// ("send_template") ali era jargão de banco na frente do operador.
const ROTULO_DO_PASSO_SO_META: Record<string, string> = {
  send_template: 'Enviar modelo',
  send_buttons: 'Enviar botões',
  send_list: 'Enviar lista',
};

export interface ChannelForValidation {
  id: string;
  label: string;
  kind: CbChannelKind;
}

/**
 * Recusa a automação quando um passo exclusivo da API oficial não tem como
 * cair num canal Meta.
 *
 * São DUAS perguntas, e por muito tempo só a segunda era feita:
 *
 * 1. **O passo fixa um canal de saída?** (`step_config.channel_id`, que ganhou
 *    tela agora). Então é ELE quem manda, e o escopo do gatilho não importa —
 *    o passo vai sair por aquele número, ponto. Canal Evolution aqui é erro
 *    mesmo com escopo vazio: era o buraco que a tela nova abriria, porque a
 *    versão anterior desta função retornava cedo quando `channelIds` era
 *    vazio e nunca chegava a olhar dentro dos passos.
 * 2. **Senão, o passo HERDA** o canal do disparo, que fica dentro do escopo.
 *    Aí basta o escopo conter algum canal Meta para a combinação ser possível
 *    — e escopo vazio ("todos") sempre é possível.
 *
 * Canal desconhecido (apagado entre editar e salvar) nunca trava a ativação:
 * o trigger da 903 limpa `channel_ids`, e para o `step_config` o builder já
 * avisa na tela. Mesma escolha de `validateFlowChannelForActivation`.
 */
export function validateChannelScopeForActivation(
  steps: StepLike[],
  channelIds: string[] | null | undefined,
  contasCanais: ChannelForValidation[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const porId = new Map(contasCanais.map((c) => [c.id, c]));

  // Herança: o escopo consegue alcançar um canal Meta?
  const escopo =
    channelIds && channelIds.length > 0
      ? contasCanais.filter((c) => channelIds.includes(c.id))
      : [];
  // Escopo vazio, ou só com ids desconhecidos, = "todos os canais".
  const herancaPodeSerMeta = escopo.length === 0 || escopo.some((c) => ehMeta(c));
  const nomesDoEscopo = escopo.map((c) => c.label).join(', ');

  const visitar = (lista: StepLike[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`;
      if (META_ONLY_STEPS.has(s.step_type)) {
        const fixado = s.step_config?.channel_id;
        const canalFixado = typeof fixado === 'string' && fixado ? porId.get(fixado) : undefined;

        if (canalFixado) {
          if (!ehMeta(canalFixado)) {
            issues.push({
              path: `${path}.channel_id`,
              message: `"${ROTULO_DO_PASSO_SO_META[s.step_type] ?? s.step_type}" só funciona em número oficial da Meta, e este passo está fixado para enviar por "${canalFixado.label}", que é um número não oficial (QR Code). Troque a conexão de saída deste passo ou use uma mensagem de texto.`,
            });
          }
        } else if (!herancaPodeSerMeta) {
          issues.push({
            path: `${path}.step_type`,
            message: `"${ROTULO_DO_PASSO_SO_META[s.step_type] ?? s.step_type}" só funciona em número oficial da Meta, e esta automação está restrita a ${nomesDoEscopo}. Inclua um canal oficial no escopo ou troque o passo por uma mensagem de texto.`,
          });
        }
      }
      if (s.step_type === 'condition' && s.step_config?.subject === 'meta_window_open') {
        conferirJanela(s, path);
      }
      // "Fixar a conversa no número" só em WhatsApp: fixada no Instagram, a
      // conversa do telefone ficaria presa num transporte que não alcança o
      // cliente. Conexão desconhecida (apagada) não trava — a mesma escolha
      // do bloco acima; o motor falha fechado nela.
      if (s.step_type === 'pin_conversation_channel') {
        const fixado = s.step_config?.channel_id;
        const canal = typeof fixado === 'string' && fixado ? porId.get(fixado) : undefined;
        if (canal && !ehWhatsApp(canal)) {
          issues.push({
            path: `${path}.channel_id`,
            message: `"Fixar a conversa no número" só vale para número de WhatsApp, e este passo aponta para "${canal.label}". Escolha um número de WhatsApp.`,
          });
        }
      }
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) visitar(s.branches.yes, `${path}.yes.`);
        if (s.branches.no) visitar(s.branches.no, `${path}.no.`);
      }
    });
  };

  // A condição "Janela de 24h da Meta aberta" (Fase 2.8 do plano do
  // previdenciário) pergunta por UM número — o do operando, ou, em branco, o
  // do disparo (senão o da conversa). Se o texto livre do ramo "Sim" sai FIXO
  // por outro número OFICIAL, a condição responde sobre uma janela que a
  // mensagem não usa: "sim" pela janela do QR Code (sempre aberta) e o texto
  // sai pelo oficial, onde a Meta o recusa (131047) com o passo contado como
  // concluído. Exige o MESMO número nos dois lados.
  //
  // Só o passo com conexão fixa OFICIAL conta: fixado num QR Code não há
  // janela a errar, e conexão desconhecida (apagada) não trava a ativação —
  // a mesma escolha do bloco acima.
  //
  // ⚠️ Passo que HERDA o disparo, com o operando preenchido (Codex, PR #315):
  // ele sai pelo número de onde o disparo veio, e a condição pergunta pelo do
  // operando. Só é seguro quando todo número OFICIAL que o escopo alcança é o
  // próprio operando — escopo só nele, ou os outros por QR Code (sem janela).
  // Com escopo vazio ("todos"), vale a conta inteira. Senão o disparo vindo
  // de outro número oficial passa pelo "Sim" do operando e o texto sai por
  // uma janela fechada.
  const oficiaisAlcancaveis = (escopo.length > 0 ? escopo : contasCanais).filter((c) =>
    ehMeta(c),
  );
  const conferirJanela = (condicao: StepLike, path: string) => {
    const operando =
      typeof condicao.step_config?.operand === 'string' ? condicao.step_config.operand : '';
    // As conexões OFICIAIS fixadas no texto do Sim (id → nome).
    const fixos = new Map<string, string>();
    let herdados = 0;
    const olhar = (lista: StepLike[]) => {
      for (const s of lista) {
        if (TEXTO_LIVRE.has(s.step_type)) {
          const fixado = s.step_config?.channel_id;
          const canal = typeof fixado === 'string' && fixado ? porId.get(fixado) : undefined;
          if (canal && ehMeta(canal)) fixos.set(canal.id, canal.label);
          // Conexão APAGADA também conta como herança: o motor não a resolve
          // e cai no número da conversa (Codex, PR #315).
          if (typeof fixado !== 'string' || !fixado || !canal) herdados += 1;
        }
        // Outra condição da janela dentro do ramo tem a SUA conferência.
        if (s.step_type === 'condition' && s.step_config?.subject !== 'meta_window_open') {
          olhar(s.branches?.yes ?? []);
          olhar(s.branches?.no ?? []);
        }
      }
    };
    olhar(condicao.branches?.yes ?? []);
    const perguntada = operando ? porId.get(operando)?.label : null;
    if (
      operando &&
      herdados > 0 &&
      oficiaisAlcancaveis.some((c) => c.id !== operando)
    ) {
      const outros = oficiaisAlcancaveis
        .filter((c) => c.id !== operando)
        .map((c) => `"${c.label}"`)
        .join(', ');
      issues.push({
        path: `${path}.operand`,
        message: `A condição "Janela de 24h da Meta aberta" pergunta pela janela de ${
          perguntada ? `"${perguntada}"` : 'uma conexão que foi removida'
        }, mas uma mensagem do ramo Sim sai pelo número do DISPARO, que pode ser outro número oficial (${outros}). Fixe a conexão de saída dessas mensagens em ${
          perguntada ? `"${perguntada}"` : 'um número'
        }, restrinja a automação a esse número, ou deixe "Janela de qual número" em branco (pergunta pelo número do disparo).`,
      });
    }
    if (fixos.size === 0 || (fixos.size === 1 && fixos.has(operando))) return;
    const nomes = [...fixos.values()].map((l) => `"${l}"`);
    const inicio = `A condição "Janela de 24h da Meta aberta" pergunta pela janela ${
      perguntada
        ? `de "${perguntada}"`
        : operando
          ? 'de uma conexão que foi removida'
          : 'do número do disparo'
    }`;
    issues.push({
      path: `${path}.operand`,
      message:
        nomes.length === 1
          ? `${inicio}, mas a mensagem do ramo Sim sai sempre por ${nomes[0]}. Escolha ${nomes[0]} em "Janela de qual número" — senão a condição responde sobre outra janela e a Meta recusa o texto.`
          : `${inicio}, mas as mensagens do ramo Sim saem por números diferentes (${nomes.join(', ')}). Uma condição responde por um número só: use uma condição da janela para cada número.`,
    });
  };

  visitar(steps, '');
  return issues;
}

/**
 * Passos de TEXTO LIVRE: a Meta só os aceita com a janela de 24h aberta. É o
 * que a condição da janela protege.
 */
const TEXTO_LIVRE = new Set(['send_message', 'send_media', 'send_buttons', 'send_list']);

// ------------------------------------------------------------
// Condição por campo personalizado (Fase 2.10 do plano do previdenciário):
// o campo existe NESTA conta, aceita o operador e — na lista — o valor é uma
// das opções. Puro: a rota carrega os campos da conta
// (`carregarCamposParaCondicoes`) e passa aqui. `null` = a leitura falhou, e a
// conferência é pulada (o motor continua sendo a guarda: campo de outra conta
// nunca é lido, e campo apagado responde "não", com a nota no registro).
// ------------------------------------------------------------
export function validateCustomFieldConditionsForActivation(
  steps: StepLike[],
  campos: ReadonlyMap<string, CampoParaCondicao> | null,
): ValidationIssue[] {
  if (!campos || !Array.isArray(steps)) return []
  const issues: ValidationIssue[] = []
  const andar = (lista: StepLike[] | undefined, prefix: string) => {
    ;(lista ?? []).forEach((s, i) => {
      const path = `${prefix}steps[${i}]`
      const c = s.step_config ?? {}
      if (s.step_type === 'condition' && c.subject === 'custom_field' && nonEmpty(c.operand)) {
        const problema = problemaDaCondicaoPorCampo(c, campos.get(String(c.operand).trim()))
        if (problema) issues.push({ path: `${path}.operand`, message: problema })
      }
      if (s.step_type === 'condition' && s.branches) {
        andar(s.branches.yes, `${path}.yes.`)
        andar(s.branches.no, `${path}.no.`)
      }
    })
  }
  andar(steps, '')
  return issues
}
