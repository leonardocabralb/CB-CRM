import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { drenarEventosDeFunil } from '@/lib/automations/drain-events'

/**
 * Aviso imediato: "acabei de mexer num card, drena a fila agora".
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE. O trigger da 933 enfileira o evento, mas quem
 * o transforma em automação é uma drenagem — e a única drenagem periódica é o
 * agendador da VPS, que roda de 15 em 15 minutos. Para "esperar 24h" isso
 * serve; para "arrastou o card → manda a mensagem" é inaceitável. Quem
 * escreveu chama aqui logo depois, e a latência cai para segundos.
 *
 * ⚠️ É OTIMIZAÇÃO, NÃO GARANTIA. A correção vem da fila + do cron: se esta
 * chamada não acontecer (aba fechada no meio, rede caindo, alguém rodando SQL
 * na mão), o evento continua pendente e o ciclo de 15 min o pega. Por isso
 * quem chama trata como fire-and-forget e ignora o resultado — falhar aqui
 * não pode desfazer o movimento do card, que já está gravado.
 *
 * A reivindicação em dois passos dentro de `drenarEventosDeFunil` é o que
 * impede esta rota e o cron de dispararem o mesmo evento.
 *
 * Sem corpo: não recebe qual evento drenar. O chamador não precisa saber o id
 * (o trigger é quem o cria, do outro lado da escrita), e aceitar um id daria
 * a quem chama a chance de pedir o disparo do evento de outra conta.
 */
export async function POST() {
  try {
    // `agent` é quem já pode mover card (a RLS de `deals` exige o mesmo
    // papel). Quem não pode mexer no funil não tem o que drenar.
    // ⚠️ FICA em 'agent' DE PROPÓSITO — não subir para admin junto com as
    // outras rotas de automação (Fase 2 dos perfis). Drenar a fila não EDITA
    // automação nenhuma: é o empurrão de latência que a tela dá quando
    // QUALQUER operador move um card (avisar-drenagem.ts, chamado pelo
    // Kanban, pelo formulário de negócio e pelo painel do contato). Com
    // 'admin' aqui, o agent que arrasta um card deixaria a automação de funil
    // esperando o ciclo de 15 min do cron — regressão silenciosa.
    await requireRole('agent')
    const resultado = await drenarEventosDeFunil()
    return NextResponse.json({ ok: true, ...resultado })
  } catch (error) {
    return toErrorResponse(error)
  }
}
