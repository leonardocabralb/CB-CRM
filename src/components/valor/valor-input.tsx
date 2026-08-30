'use client';

// ============================================================
// Campo de valor em real.
//
// Sem foco mostra `R$ 40.000,00`; com foco vira o número editável (`40000`).
// Um componente só para os DOIS campos de valor do app — o do painel da
// conversa e o do formulário de negócio. Duas cópias divergiriam na primeira
// correção, e as regras aqui não são óbvias: qualquer diferença entre eles
// grava valor diferente para o mesmo gesto.
//
// ⚠️ `type="text"`, não `type="number"`. O campo numérico do navegador
// RECUSA `R$`, ponto de milhar e vírgula — a máscara é impossível ali. O
// preço de sair dele é que a conversão passa a ser nossa, e é o que
// `src/lib/valor/mascara.ts` faz (com teste).
// ============================================================

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/currency';
import { paraEdicao, parsearValor } from '@/lib/valor/mascara';

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

export function ValorInput({
  valor,
  aoMudar,
  aoConfirmar,
  disabled,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: ValorInputProps) {
  // `null` = não está sendo editado. Guardar o texto cru (e não o número) é
  // o que deixa digitar estados intermediários que não são número nenhum —
  // "1250," a caminho de "1250,50" — sem o campo apagar o que foi digitado.
  const [rascunho, setRascunho] = useState<string | null>(null);
  const editando = rascunho !== null;
  const campo = useRef<HTMLInputElement>(null);

  // Seleciona tudo ao entrar no campo, para clicar e digitar substituir o
  // valor inteiro — que é o gesto de quem corrige dinheiro.
  //
  // ⚠️ Tem de ser um efeito, e a dependência é o BOOLEANO, não o rascunho.
  // Medido no navegador: selecionar dentro do próprio `onFocus` (mesmo
  // adiando com `requestAnimationFrame`) não vinga — o React ainda troca o
  // texto formatado pelo editável depois disso, e a troca joga o cursor para
  // o fim. Com `rascunho` na dependência, o efeito voltaria a rodar a cada
  // tecla e selecionaria tudo enquanto a pessoa digita.
  useEffect(() => {
    if (editando) campo.current?.select();
  }, [editando]);

  // ⚠️ Zero mostra o campo VAZIO, não `R$ 0,00`, e é o comportamento que já
  // existia (`defaultValue={deal.value || ''}`). A coluna é NOT NULL com
  // default 0, então TODO negócio recém-criado tem zero ali — encher a tela
  // de `R$ 0,00` faria "ainda não informei" parecer "vale zero", e o
  // placeholder do campo nunca mais apareceria.
  const semFoco = Number(valor) ? formatCurrency(valor) : '';

  return (
    <Input
      ref={campo}
      type="text"
      // Teclado numérico no celular sem perder a máscara.
      inputMode="decimal"
      value={editando ? rascunho : semFoco}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      onFocus={() => setRascunho(paraEdicao(valor))}
      onChange={(e) => {
        setRascunho(e.target.value);
        aoMudar?.(parsearValor(e.target.value) ?? 0);
      }}
      onBlur={() => {
        const novo = parsearValor(rascunho ?? '') ?? 0;
        // Volta ao formato antes de avisar quem escuta: o `aoConfirmar` pode
        // recarregar a lista e desmontar isto no meio.
        setRascunho(null);
        if (novo !== (Number(valor) || 0)) aoConfirmar?.(novo);
      }}
    />
  );
}
