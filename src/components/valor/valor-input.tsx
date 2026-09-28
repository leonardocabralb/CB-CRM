'use client';

// ============================================================
// Campo de valor em real.
//
// Mostra `R$ 40.000,00` com e sem foco: a máscara formata a CADA TECLA
// (decisão do operador em 28/09/2026 — até ali, com foco, o campo virava o
// número cru `40000` e só formatava ao sair). Os dígitos entram como reais,
// com o cursor parado antes da vírgula; a vírgula leva aos centavos. As
// regras moram em `src/lib/valor/mascara.ts`, puras e com teste.
//
// Um componente só para os DOIS campos de valor do app — o do painel da
// conversa e o do formulário de negócio. Duas cópias divergiriam na primeira
// correção, e as regras aqui não são óbvias: qualquer diferença entre eles
// grava valor diferente para o mesmo gesto.
//
// ⚠️ `type="text"`, não `type="number"`. O campo numérico do navegador
// RECUSA `R$`, ponto de milhar e vírgula — a máscara é impossível ali. O
// preço de sair dele é que a conversão passa a ser nossa.
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/currency';
import {
  aplicarEdicao,
  colar,
  type Edicao,
  irParaCentavos,
  paraEdicao,
  parsearValor,
} from '@/lib/valor/mascara';

export interface ValorInputProps {
  /** Valor atual, em reais. `null` e 0 mostram o campo vazio. */
  valor: number | null | undefined;
  /**
   * A cada tecla, já convertido. Para formulário com botão Salvar, onde o
   * estado do pai precisa estar em dia mesmo se o operador clicar em salvar
   * sem sair do campo — o blur até dispara antes do clique, mas depender
   * disso é apostar na ordem de eventos do navegador.
   */
  aoMudar?: (valor: number) => void;
  /**
   * Ao sair do campo, e SÓ quando o valor mudou de fato. Para quem salva
   * sozinho: sem a comparação, entrar e sair do campo gravaria no banco e
   * escreveria uma linha na trilha de auditoria (912) sem ninguém ter
   * editado nada.
   */
  aoConfirmar?: (valor: number) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * O texto em edição e onde pôr o cursor. `cursor: null` = não mexer (é o
 * caso da entrada no campo, que seleciona tudo).
 */
type EmEdicao = { texto: string; cursor: number | null };

export function ValorInput({
  valor,
  aoMudar,
  aoConfirmar,
  disabled,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: ValorInputProps) {
  // `null` = não está sendo editado. É um objeto novo a cada tecla, de
  // propósito: tecla rejeitada (uma letra, o 11º dígito) devolve o MESMO
  // texto, e mesmo assim o cursor precisa voltar para o lugar.
  const [edicao, setEdicao] = useState<EmEdicao | null>(null);
  const editando = edicao !== null;
  const campo = useRef<HTMLInputElement>(null);

  // Seleciona tudo ao entrar no campo, para clicar e digitar substituir o
  // valor inteiro — que é o gesto de quem corrige dinheiro.
  //
  // ⚠️ A dependência é o BOOLEANO, não o texto: com o texto, o efeito
  // voltaria a rodar a cada tecla e selecionaria tudo enquanto a pessoa
  // digita.
  useEffect(() => {
    if (editando) campo.current?.select();
  }, [editando]);

  // A máscara reescreve o texto a cada tecla, e trocar o `value` joga o
  // cursor para o fim. Efeito de LAYOUT (antes da pintura) para o cursor
  // não aparecer no fim por um quadro.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el || edicao?.cursor == null || document.activeElement !== el) return;
    el.setSelectionRange(edicao.cursor, edicao.cursor);
  }, [edicao]);

  // ⚠️ Zero mostra o campo VAZIO, não `R$ 0,00`, e é o comportamento que já
  // existia (`defaultValue={deal.value || ''}`). A coluna é NOT NULL com
  // default 0, então TODO negócio recém-criado tem zero ali — encher a tela
  // de `R$ 0,00` faria "ainda não informei" parecer "vale zero", e o
  // placeholder do campo nunca mais apareceria.
  const semFoco = Number(valor) ? formatCurrency(valor) : '';

  const aplicar = (prox: Edicao) => {
    setEdicao(prox);
    aoMudar?.(parsearValor(prox.texto) ?? 0);
  };

  return (
    <Input
      ref={campo}
      type="text"
      // Teclado numérico no celular sem perder a máscara.
      inputMode="decimal"
      value={editando ? edicao.texto : semFoco}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      onFocus={() => setEdicao({ texto: paraEdicao(valor), cursor: null })}
      onChange={(e) => {
        const el = e.target;
        aplicar(
          aplicarEdicao(
            edicao?.texto ?? '',
            el.value,
            el.selectionStart ?? el.value.length,
            (e.nativeEvent as InputEvent).inputType,
          ),
        );
      }}
      onPaste={(e) => {
        // Colado, o texto vem em qualquer formato, e a vírgula dele seria
        // lida pela máscara como "vá para os centavos".
        e.preventDefault();
        const prox = colar(e.clipboardData.getData('text'));
        if (prox) aplicar(prox);
      }}
      onKeyDown={(e) => {
        if (e.code !== 'NumpadDecimal') return;
        e.preventDefault();
        setEdicao(irParaCentavos(edicao?.texto ?? ''));
      }}
      onBlur={() => {
        const novo = parsearValor(edicao?.texto ?? '') ?? 0;
        // Volta ao formato antes de avisar quem escuta: o `aoConfirmar` pode
        // recarregar a lista e desmontar isto no meio.
        setEdicao(null);
        if (novo !== (Number(valor) || 0)) aoConfirmar?.(novo);
      }}
    />
  );
}
