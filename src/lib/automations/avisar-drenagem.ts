/**
 * Avisa o servidor que um card se mexeu, para a fila de automações drenar
 * AGORA em vez de esperar o ciclo de 15 minutos do agendador.
 *
 * ⚠️ Fire-and-forget de verdade: nunca lança, nunca devolve nada, e quem
 * chama NÃO deve esperar por ela antes de atualizar a tela. O movimento do
 * card já está gravado quando isto roda — a fila e o cron garantem a
 * correção, e este aviso só compra latência. Falhar aqui não pode virar toast
 * de erro nem desfazer a jogada do operador.
 *
 * ⚠️ Um único helper para os DOIS escritores de navegador (o arrastar do
 * Kanban e o formulário de negócio), de propósito. Duas cópias divergem, e a
 * que divergir vai ser a que esquece de avisar — o defeito reaparece só num
 * dos caminhos, que é o mais difícil de perceber.
 */
export function avisarDrenagemDeFunil(): void {
  // `keepalive` para o pedido sobreviver se o operador navegar logo depois de
  // arrastar o card — sem ele o navegador cancela e a mensagem só sairia no
  // ciclo do cron.
  void fetch('/api/automations/events/drain', {
    method: 'POST',
    keepalive: true,
  }).catch(() => {
    // Silêncio proposital. O cron é a rede de segurança.
  })
}
