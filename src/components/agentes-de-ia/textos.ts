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
  'agente_de_outra_conta',
  'membro_de_outra_conta',
  'passar_para_si',
  'nao_encontrado',
  'sem_chave',
  'chave_ilegivel',
  'sem_mensagens',
  'sem_configuracao',
  'cotacao_invalida',
  'invalid_key',
  'rate_limited',
  'timeout',
  'network_error',
  'banco',
] as const;

export function textoDoCodigo(t: ReturnType<typeof useTranslations>, codigo: unknown): string {
  return typeof codigo === 'string' && (CODIGOS_CONHECIDOS as readonly string[]).includes(codigo)
    ? t(`erro.${codigo}`)
    : t('erro.generico');
}
