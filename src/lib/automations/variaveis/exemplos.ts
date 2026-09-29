import { diaNoFuso, FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso';
import type { ParcelaDoEspelho } from '@/lib/asaas/inadimplencia';
import { montarVariaveis, somarDias } from '@/lib/asaas/regua';
import { EVENTO_AGENDADO } from '@/lib/calendly/payload';
import { variaveisDoAgendamento } from '@/lib/calendly/variaveis';
import { variaveisDoDocumento } from '@/lib/zapsign/variaveis';

/**
 * O EXEMPLO das `{{vars.*}}` de cada gatilho, para o botão "Inserir campo" e a
 * prévia do construtor: cobrança do Asaas, agendamento do Calendly e
 * assinatura do ZapSign só existem no instante do evento, então a prévia de um
 * cliente escolhido não tem de onde tirá-las.
 *
 * ⚠️⚠️ Condição do operador (29/09/2026): o exemplo NÃO pode pedir manutenção
 * quando o código mudar. Por isso nada aqui é texto pronto — cada exemplo sai
 * das MESMAS funções que montam as variáveis do envio (`montarVariaveis`,
 * `variaveisDoAgendamento`, `variaveisDoDocumento`), alimentadas com dados
 * fictícios. Mudou o formato de uma linha de parcela, o exemplo muda junto;
 * variável nova aparece sozinha (e `catalogo.test.ts` cobra o nome e a
 * legenda dela nos dois dicionários). O que é fixo aqui é só a ENTRADA, e o
 * TypeScript acusa quando o formato dela muda.
 *
 * O nome do cliente escolhido na prévia entra no lugar do fictício (o Asaas e o
 * Calendly o trazem no evento real), e o do escritório é o da conta.
 * O webhook de entrada não passa por aqui: o exemplo dele é o último
 * acionamento REAL, que a tela busca.
 */

export interface OpcoesDoExemplo {
  agora?: Date;
  /** O nome do cliente escolhido na prévia; sem ele, um fictício. */
  nome?: string | null;
  /** O nome da conta (a régua do Asaas usa o da conta). */
  escritorio?: string | null;
  fuso?: string;
}

const NOME_FICTICIO = 'Maria Souza';
const EMAIL_FICTICIO = 'cliente@exemplo.com';

export function exemplosDoGatilho(
  tipoDoGatilho: string,
  opcoes: OpcoesDoExemplo = {},
): Record<string, string> | null {
  const agora = opcoes.agora ?? new Date();
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const nome = opcoes.nome?.trim() || NOME_FICTICIO;
  const escritorio = opcoes.escritorio?.trim() ?? '';
  const hoje = diaNoFuso(agora, fuso);

  const parcela = (p: Partial<ParcelaDoEspelho> & Pick<ParcelaDoEspelho, 'vencimento'>): ParcelaDoEspelho => ({
    id: 'exemplo',
    asaas_payment_id: 'pay_exemplo',
    asaas_customer_id: 'cus_exemplo',
    status: 'PENDING',
    deleted: false,
    valor: 648.2,
    juros_e_multa: null,
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: 'BOLETO',
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: 'ins_exemplo',
    parcela_numero: 3,
    parcela_total: 12,
    link_fatura: 'https://www.asaas.com/i/exemplo',
    link_boleto: null,
    visto_em: agora.toISOString(),
    ...p,
  });

  switch (tipoDoGatilho) {
    case 'asaas_cobranca_vencida': {
      // Uma parcela que cruzou o marco e outra que vence hoje: sem a segunda,
      // `vence_hoje_detalhe` sairia vazio no exemplo e o operador não veria o
      // formato dela.
      const atrasada = parcela({
        vencimento: somarDias(hoje, -5),
        status: 'OVERDUE',
        juros_e_multa: 12.35,
        parcela_numero: 2,
      });
      const deHoje = parcela({ vencimento: hoje });
      return montarVariaveis({
        clienteNome: nome,
        escritorioNome: escritorio,
        vencidas: [atrasada],
        cruzaram: [atrasada],
        venceHoje: [deHoje],
        hoje,
        agora,
        fuso,
      });
    }
    case 'asaas_cobranca_vence_hoje':
      return montarVariaveis({
        clienteNome: nome,
        escritorioNome: escritorio,
        vencidas: [],
        cruzaram: [],
        venceHoje: [parcela({ vencimento: hoje })],
        hoje,
        agora,
        fuso,
      });
    case 'calendly_booking': {
      const inicio = paraInstante(somarDias(hoje, 1), '14:00', fuso);
      const fim = new Date(inicio.getTime() + 30 * 60_000);
      return variaveisDoAgendamento(
        {
          evento: EVENTO_AGENDADO,
          inviteeUri: 'https://api.calendly.com/scheduled_events/exemplo/invitees/exemplo',
          nome,
          email: EMAIL_FICTICIO,
          telefone: '5511999990000',
          telefoneOrigem: null,
          eventoUri: null,
          eventoNome: 'Reunião com advogado',
          eventoAgendadoUri: null,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
          link: 'https://meet.google.com/abc-defg-hij',
          local: null,
          cancelarUrl: 'https://calendly.com/cancellations/exemplo',
          remarcarUrl: 'https://calendly.com/reschedulings/exemplo',
          reagendado: false,
          fusoDoConvidado: fuso,
          perguntas: [],
        },
        fuso,
      );
    }
    case 'zapsign_documento_assinado':
      // Sem respostas de formulário: elas dependem das perguntas de cada
      // modelo do ZapSign, e um exemplo inventado afirmaria uma pergunta que
      // o formulário do operador pode não ter.
      return variaveisDoDocumento(
        { token: 'exemplo-0000-0000', nome: 'Contrato de prestação de serviços' },
        {
          token: 'exemplo-signatario',
          status: 'signed',
          nome,
          email: EMAIL_FICTICIO,
          telefone: '+5511999990000',
          cpf: null,
          assinadoEm: agora.toISOString(),
        },
        agora.toISOString(),
        {},
        fuso,
      );
    default:
      return null;
  }
}

export type FamiliaComExemplo = 'asaas' | 'calendly' | 'zapsign';

/**
 * Os NOMES das variáveis de cada família, colhidos das próprias funções que as
 * montam (as chaves do exemplo) — nunca digitados: variável nova no código
 * aparece aqui sozinha, e o teste dos dicionários a cobra.
 */
export const NOMES_DO_EVENTO: Readonly<Record<FamiliaComExemplo, readonly string[]>> = {
  asaas: Object.keys(exemplosDoGatilho('asaas_cobranca_vencida', { agora: new Date(0) }) ?? {}),
  calendly: Object.keys(exemplosDoGatilho('calendly_booking', { agora: new Date(0) }) ?? {}),
  zapsign: Object.keys(exemplosDoGatilho('zapsign_documento_assinado', { agora: new Date(0) }) ?? {}),
};
