import type { useTranslations } from 'next-intl';

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
