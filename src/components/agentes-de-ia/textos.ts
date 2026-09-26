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
 * `detalhe` é o texto SEGURO que a rota manda junto (`mensagemSeguraDeAiError`
 * — nunca ecoa a chave). Só o `provider_error` o usa: é ele que diz "modelo não
 * encontrado" ou "chave recusada" quando o provedor devolve 400/404, e sem ele
 * a tela diria "tente de novo" para um erro que nunca vai passar.
 */
export function textoDoCodigo(
  t: ReturnType<typeof useTranslations>,
  codigo: unknown,
  detalhe?: unknown,
): string {
  if (typeof codigo !== 'string' || !(CODIGOS_CONHECIDOS as readonly string[]).includes(codigo)) {
    return t('erro.generico');
  }
  if (codigo === 'provider_error') {
    return t('erro.provider_error', {
      detalhe: typeof detalhe === 'string' && detalhe.trim() ? detalhe.trim() : '—',
    });
  }
  return t(`erro.${codigo}`);
}
