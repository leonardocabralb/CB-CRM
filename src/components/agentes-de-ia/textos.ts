import type { useTranslations } from 'next-intl';

import {
  ACAO_TRANSFERIR,
  ACOES_COM_VALOR,
  ACOES_COM_VALOR_OPCIONAL,
  type CodigoDeFalhaDaAcao,
  type MotivoDaRecusa,
  type MotivoForaDaD5,
} from '@/lib/ia-agentes/acoes';

import { BLOCOS_DO_ACESSO, TIPOS_DE_ACAO } from './tipos';

/**
 * Os CÓDIGOS que as rotas dos agentes devolvem, traduzidos pelo dicionário
 * (`IaAgentes.erro.<código>`). Chave MONTADA: o teste
 * `textos.test.ts` cobra cada uma nos dois dicionários.
 */
export const CODIGOS_CONHECIDOS = [
  'nome_vazio',
  'nome_longo',
  'nome_repetido',
  'descricao_longa',
  'instrucoes_longas',
  'regras_demais',
  'regra_longa',
  'provedor_invalido',
  'modelo_vazio',
  'teto_invalido',
  'horario_invalido',
  'lista_invalida',
  'conexao_de_outra_conta',
  'conexao_instagram',
  'agente_de_outra_conta',
  'membro_de_outra_conta',
  'passar_para_si',
  'etapa_de_outra_conta',
  'etapa_ocupada',
  'nao_encontrado',
  'sem_chave',
  'provedor_sem_chave',
  'provedor_so_da_base',
  'chave_ilegivel',
  'sem_mensagens',
  'sem_configuracao',
  'cotacao_invalida',
  'documento_invalido',
  'contato_nao_encontrado',
  // As recusas do Salvar das Ferramentas (F4): o PATCH devolve também `itens`.
  'etapa_de_resultado',
  'item_de_outra_conta',
  'campo_vigiado',
  'automacao_fora_da_d5',
  // O servidor não o devolve mais (a D5 deixou de percorrer a cascata em
  // 27/09/2026); fica para uma tela aberta contra um servidor anterior.
  'cascata_fora_da_d5',
  // "Marcar reunião" (F5): o tipo de evento não é um ativo do Calendly
  // conectado, ou não há Calendly conectado (`itens` = a uri).
  'tipo_de_evento_invalido',
  'calendly_desconectado',
  'invalid_key',
  'rate_limited',
  'timeout',
  'network_error',
  'provider_error',
  'empty_response',
  'banco',
] as const;

/**
 * `detalhe` é o texto que a rota manda junto. No `provider_error`, o texto
 * SEGURO do provedor (`mensagemSeguraDeAiError` — nunca ecoa a chave): é ele
 * que diz "modelo não encontrado" ou "chave recusada" quando o provedor
 * devolve 400/404, e sem ele a tela diria "tente de novo" para um erro que
 * nunca vai passar. No `etapa_ocupada`, o NOME do agente que já atua na etapa.
 */
export function textoDoCodigo(
  t: ReturnType<typeof useTranslations>,
  codigo: unknown,
  detalhe?: unknown,
): string {
  if (typeof codigo !== 'string' || !(CODIGOS_CONHECIDOS as readonly string[]).includes(codigo)) {
    return t('erro.generico');
  }
  const texto = typeof detalhe === 'string' && detalhe.trim() ? detalhe.trim() : '—';
  if (codigo === 'provider_error') return t('erro.provider_error', { detalhe: texto });
  if (codigo === 'etapa_ocupada') return t('erro.etapa_ocupada', { agente: texto });
  return t(`erro.${codigo}`);
}

/**
 * Os status de `cb_ia_turnos` (1049) que a sub-aba Turnos traduz
 * (`IaAgentes.turnos.status.<status>`). Chave MONTADA: `textos.test.ts` cobra
 * cada uma nos dois dicionários. Status fora da lista (um novo no CHECK) cai
 * em `turnos.statusDesconhecido`, nunca na chave crua.
 */
export const STATUS_DO_TURNO = [
  'aguardando',
  'rodando',
  'respondeu',
  'passou',
  'transferiu',
  'sem_resposta',
  'fora_do_horario',
  'pausado_no_meio',
  'descartado',
  'falhou',
  'incerto',
] as const;

export function rotuloDoStatusDoTurno(t: ReturnType<typeof useTranslations>, status: string): string {
  return (STATUS_DO_TURNO as readonly string[]).includes(status)
    ? t(`turnos.status.${status}`)
    : t('turnos.statusDesconhecido', { status });
}

/**
 * O nome de um bloco do acesso (F3) — na sub-aba Acesso, no "o agente viu"
 * do Playground e no retrato da sub-aba Turnos (`IaAgentes.acesso.bloco.<b>`).
 * Chave MONTADA, cobrada em `textos.test.ts`. Bloco fora da lista (um novo no
 * servidor antes da tela) cai em `acesso.blocoDesconhecido`, nunca na chave crua.
 */
export function rotuloDoBloco(t: ReturnType<typeof useTranslations>, bloco: string): string {
  return (BLOCOS_DO_ACESSO as readonly string[]).includes(bloco)
    ? t(`acesso.bloco.${bloco}`)
    : t('acesso.blocoDesconhecido', { bloco });
}

/**
 * O nome de um tipo de ação (F4) — na sub-aba Ferramentas, nas recusadas do
 * Playground e nas ações da sub-aba Turnos (`IaAgentes.ferramentas.tipo.<t>.nome`).
 * Chave MONTADA, cobrada em `textos.test.ts`. O `[[TRANSFERIR]]` ("responda e
 * passe", 27/09/2026 — não é ferramenta) tem rótulo próprio. Tipo fora da
 * lista (um novo no servidor antes da tela) cai em `ferramentas.tipoDesconhecido`,
 * nunca na chave crua.
 */
export function rotuloDoTipoDeAcao(t: ReturnType<typeof useTranslations>, tipo: string): string {
  if (tipo === ACAO_TRANSFERIR) return t('ferramentas.transferir');
  return (TIPOS_DE_ACAO as readonly string[]).includes(tipo)
    ? t(`ferramentas.tipo.${tipo}.nome`)
    : t('ferramentas.tipoDesconhecido', { tipo });
}

/**
 * Uma ação ACEITA no Playground, como frase curta ("mover para Proposta",
 * "tarefa para Ana", "marcar reunião em 28/09/2026 15:15" — na reunião, o
 * `nome` é a data e a hora no fuso do escritório) — `IaAgentes.playground.acao.<t>`, com `{nome}`. Com o
 * `valor` (o do campo, o título da tarefa, o nome do convidado na reunião),
 * `playground.acaoComValor.<t>`: "tarefa para Ana: Ligar amanhã", "preencher
 * Tamanho da dívida = 200 mil", "marcar reunião em 28/09/2026 15:15 para Ana
 * Souza".
 * Chaves MONTADAS, cobradas em `textos.test.ts`.
 */
export function fraseDaAcao(
  t: ReturnType<typeof useTranslations>,
  tipo: string,
  nome: string,
  valor?: string,
): string {
  // "Responda e passe" (`[[TRANSFERIR]]`): sem nome — "transferir para a equipe".
  if (tipo === ACAO_TRANSFERIR) return t('playground.acaoTransferir');
  if (!(TIPOS_DE_ACAO as readonly string[]).includes(tipo)) return t('playground.acaoDesconhecida', { tipo, nome });
  const comValor = (ACOES_COM_VALOR as ReadonlySet<string>).has(tipo) || (ACOES_COM_VALOR_OPCIONAL as ReadonlySet<string>).has(tipo);
  if (valor && comValor) return t(`playground.acaoComValor.${tipo}`, { nome, valor });
  return t(`playground.acao.${tipo}`, { nome });
}

/**
 * Os tipos de campo personalizado (`custom_fields.field_type`, o CHECK da 948,
 * mais `email` — o campo que espelha o e-mail da ficha) que a sub-aba
 * Ferramentas mostra ao lado do nome (`IaAgentes.ferramentas.campo.<tipo>`).
 * Chave MONTADA, cobrada em `textos.test.ts`. Tipo fora da lista não ganha
 * rótulo (nulo): a tela não afirma um tipo que não conhece.
 */
export const TIPOS_DE_CAMPO = ['text', 'datetime', 'select', 'number', 'email'] as const;

export function rotuloDoTipoDoCampo(t: ReturnType<typeof useTranslations>, tipo: string | null): string | null {
  return tipo !== null && (TIPOS_DE_CAMPO as readonly string[]).includes(tipo) ? t(`ferramentas.campo.${tipo}`) : null;
}

/**
 * Os códigos com que o servidor diz POR QUE uma automação não pode ser
 * liberada (o passo fora da D5 — `foraDaD5` das opções). Chave MONTADA
 * (`IaAgentes.ferramentas.foraDaD5.<código>`), cobrada em `textos.test.ts`.
 * (`MotivoForaDaD5` de `acoes.ts`; `textos.test.ts` cobra que a lista o cubra).
 * `campo_vigiado`: o validador da D5 recusa também o `update_contact_field`
 * num campo de data vigiado por lembrete (plano, 5.6). `aguardar`: a
 * automação que a IA executa DIRETAMENTE não pode pausar (a retomada não
 * confere o agente) — na lista de automações tem frase própria
 * (`ferramentas.bloqueio.aguardar`). Os mesmos códigos dizem o passo de um
 * `cascata_fora_da_d5` nos registros ANTIGOS da aba Turnos (a D5 deixou de
 * percorrer a cascata em 27/09/2026).
 */
export const CODIGOS_DA_D5 = [
  'send_to_number',
  'send_webhook',
  'status_de_resultado',
  'etapa_de_resultado',
  'run_flow',
  'campo_vigiado',
  'aguardar',
] as const satisfies readonly MotivoForaDaD5[];

/** Código fora da lista (um passo novo proibido pelo servidor) cai em `foraDaD5.outro`. */
export function motivoForaDaD5(t: ReturnType<typeof useTranslations>, codigo: string): string {
  return (CODIGOS_DA_D5 as readonly string[]).includes(codigo)
    ? t(`ferramentas.foraDaD5.${codigo}`)
    : t('ferramentas.foraDaD5.outro');
}

/**
 * Por que o servidor RECUSOU uma ação pedida (`MotivoDaRecusa` de
 * `acoes.ts`) — nas recusadas do Playground e no erro de uma ação da
 * sub-aba Turnos (`IaAgentes.ferramentas.recusa.<código>`). Chave MONTADA,
 * cobrada em `textos.test.ts`. Código fora da lista cai em
 * `ferramentas.recusa.outro`, nunca na chave crua.
 */
export const MOTIVOS_DE_RECUSA = [
  'malformada',
  'teto',
  'nao_liberada',
  'fora_da_lista',
  'passagem',
  'transferencia',
] as const satisfies readonly MotivoDaRecusa[];

export function motivoDaRecusa(t: ReturnType<typeof useTranslations>, motivo: string): string {
  return (MOTIVOS_DE_RECUSA as readonly string[]).includes(motivo)
    ? t(`ferramentas.recusa.${motivo}`)
    : t('ferramentas.recusa.outro');
}

/**
 * A chave do dicionário de cada código que o registro de uma ação pode ter
 * (`cb_ia_turnos.acoes[].erro`): as recusas (`MotivoDaRecusa`) e as falhas na
 * hora de executar (`CODIGOS_DE_FALHA_DA_ACAO`). Record EXAUSTIVO: código
 * novo no servidor não compila sem entrada aqui, e `textos.test.ts` cobra
 * cada chave nos dois dicionários.
 */
export const CHAVE_DO_ERRO_DA_ACAO = {
  malformada: 'ferramentas.recusa.malformada',
  teto: 'ferramentas.recusa.teto',
  nao_liberada: 'ferramentas.recusa.nao_liberada',
  fora_da_lista: 'ferramentas.recusa.fora_da_lista',
  passagem: 'ferramentas.recusa.passagem',
  transferencia: 'ferramentas.recusa.transferencia',
  sem_card: 'turnos.acoes.erro.sem_card',
  card_fechado: 'turnos.acoes.erro.card_fechado',
  item_de_outra_conta: 'turnos.acoes.erro.item_de_outra_conta',
  etapa_de_resultado: 'turnos.acoes.erro.etapa_de_resultado',
  // Só no "preencher campo": o CAMPO é vigiado (a automação vigiando sai em `automacao_fora_da_d5`).
  campo_vigiado: 'turnos.acoes.erro.campo_vigiado',
  valor_vazio: 'turnos.acoes.erro.valor_vazio',
  valor_invalido: 'turnos.acoes.erro.valor_invalido',
  titulo_invalido: 'turnos.acoes.erro.titulo_invalido',
  // Estes dois levam `{motivo}`: o passo da D5, que vem em `detalhe`.
  automacao_fora_da_d5: 'turnos.acoes.erro.automacao_fora_da_d5',
  cascata_fora_da_d5: 'turnos.acoes.erro.cascata_fora_da_d5',
  automacao_desligada: 'turnos.acoes.erro.automacao_desligada',
  fora_da_conexao: 'turnos.acoes.erro.fora_da_conexao',
  fora_da_etapa: 'turnos.acoes.erro.fora_da_etapa',
  // A reunião (F5): sem e-mail, horário tomado, Calendly desconectado.
  sem_email: 'turnos.acoes.erro.sem_email',
  sem_telefone: 'turnos.acoes.erro.sem_telefone',
  horario_indisponivel: 'turnos.acoes.erro.horario_indisponivel',
  calendly_desconectado: 'turnos.acoes.erro.calendly_desconectado',
  envio_falhou: 'turnos.acoes.erro.envio_falhou',
  recusado: 'turnos.acoes.erro.recusado',
  falhou: 'turnos.acoes.erro.falhou',
} as const satisfies Record<MotivoDaRecusa | CodigoDeFalhaDaAcao, string>;

type CodigoDoErroDaAcao = keyof typeof CHAVE_DO_ERRO_DA_ACAO;

function ehCodigoDoErroDaAcao(v: string): v is CodigoDoErroDaAcao {
  return Object.prototype.hasOwnProperty.call(CHAVE_DO_ERRO_DA_ACAO, v);
}

/**
 * O complemento cru de uma ação (`detalhe`): `ja_estava` (a ação REPETIDA —
 * o card já estava na etapa, a etiqueta já estava ou não estava, o campo já
 * tinha o valor: deu certo sem mexer em nada) vira texto; o resto (a recusa
 * da RPC, a mensagem do motor) aparece como veio.
 */
export function textoDoDetalheDaAcao(t: ReturnType<typeof useTranslations>, detalhe: string): string {
  return detalhe === 'ja_estava' ? t('turnos.acoes.jaEstava') : detalhe;
}

/**
 * Por que uma ação do turno não fez efeito, em texto. O código
 * (`CHAVE_DO_ERRO_DA_ACAO`) vira a frase; `automacao_fora_da_d5` e
 * `cascata_fora_da_d5` levam o passo da D5 que veio em `detalhe`, traduzido;
 * qualquer outro `detalhe` vai depois, cru ("… — status_mudou"). Registro
 * antigo com código fora das listas: o texto genérico com o código cru —
 * nunca a chave do dicionário na tela.
 */
export function textoDoErroDaAcao(
  t: ReturnType<typeof useTranslations>,
  acao: { erro?: string; detalhe?: string },
): string {
  const detalhe = acao.detalhe?.trim() || undefined;
  const erro = acao.erro?.trim() || undefined;
  let texto: string;
  let resto = detalhe;
  if (!erro) {
    texto = t('turnos.acoes.erro.semCodigo');
  } else if (!ehCodigoDoErroDaAcao(erro)) {
    texto = t('turnos.acoes.erro.desconhecido', { erro });
  } else if (erro === 'automacao_fora_da_d5' || erro === 'cascata_fora_da_d5') {
    // O passo da D5 entra NA frase; um detalhe que não é passo conhecido cai
    // no "outro" e ainda aparece cru depois.
    const conhecido = detalhe !== undefined && (CODIGOS_DA_D5 as readonly string[]).includes(detalhe);
    texto = t(CHAVE_DO_ERRO_DA_ACAO[erro], { motivo: motivoForaDaD5(t, conhecido ? detalhe : '') });
    if (conhecido) resto = undefined;
  } else {
    texto = t(CHAVE_DO_ERRO_DA_ACAO[erro]);
  }
  return resto ? t('turnos.acoes.comDetalhe', { texto, detalhe: textoDoDetalheDaAcao(t, resto) }) : texto;
}
