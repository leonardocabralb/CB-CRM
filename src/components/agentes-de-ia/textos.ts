import type { useTranslations } from 'next-intl';

import type { MotivoDaRecusa, MotivoForaDaD5 } from '@/lib/ia-agentes/acoes';

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
 * Chave MONTADA, cobrada em `textos.test.ts`. Tipo fora da lista (um novo no
 * servidor antes da tela) cai em `ferramentas.tipoDesconhecido`, nunca na chave crua.
 */
export function rotuloDoTipoDeAcao(t: ReturnType<typeof useTranslations>, tipo: string): string {
  return (TIPOS_DE_ACAO as readonly string[]).includes(tipo)
    ? t(`ferramentas.tipo.${tipo}.nome`)
    : t('ferramentas.tipoDesconhecido', { tipo });
}

/**
 * Uma ação ACEITA no Playground, como frase curta ("mover para Proposta",
 * "tarefa para Ana") — `IaAgentes.playground.acao.<t>`, com `{nome}`. Chave
 * MONTADA, cobrada em `textos.test.ts`.
 */
export function fraseDaAcao(t: ReturnType<typeof useTranslations>, tipo: string, nome: string): string {
  return (TIPOS_DE_ACAO as readonly string[]).includes(tipo)
    ? t(`playground.acao.${tipo}`, { nome })
    : t('playground.acaoDesconhecida', { tipo, nome });
}

/**
 * Os códigos com que o servidor diz POR QUE uma automação não pode ser
 * liberada (o passo fora da D5 — `foraDaD5` das opções). Chave MONTADA
 * (`IaAgentes.ferramentas.foraDaD5.<código>`), cobrada em `textos.test.ts`.
 * (`MotivoForaDaD5` de `acoes.ts`; `textos.test.ts` cobra que a lista o cubra).
 * `campo_vigiado`: o validador da D5 recusa também o `update_contact_field`
 * num campo de data vigiado por lembrete (plano, 5.6).
 */
export const CODIGOS_DA_D5 = [
  'send_to_number',
  'send_webhook',
  'status_de_resultado',
  'etapa_de_resultado',
  'run_flow',
  'campo_vigiado',
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
 * O erro de uma ação no registro do turno (`cb_ia_turnos.acoes[].erro`): um
 * CÓDIGO conhecido (a recusa, ou o passo fora da D5 conferido de novo na
 * hora) vira texto; o resto é a mensagem do motor, que aparece como veio —
 * é ela que diz por que a escrita falhou.
 */
export function textoDoErroDaAcao(t: ReturnType<typeof useTranslations>, erro: string): string {
  if ((MOTIVOS_DE_RECUSA as readonly string[]).includes(erro)) return motivoDaRecusa(t, erro);
  if ((CODIGOS_DA_D5 as readonly string[]).includes(erro)) {
    return t('ferramentas.bloqueio.foraDaD5', { motivo: motivoForaDaD5(t, erro) });
  }
  return erro;
}
