'use client';

import { Component, type ReactNode } from 'react';

// ============================================================
// Se o RESUMO quebrar, a pessoa ENTRA.
//
// O repositório não tem nenhum error boundary (nem `error.tsx`), e a porta de
// entrada substitui o app inteiro até o "Continuar": uma exceção na tela de
// resumo trancaria todo mundo do lado de fora, com a tela branca do Next. A
// tela é um lembrete; o app é o trabalho. Na dúvida, o app.
// ============================================================

interface Props {
  /** O que renderizar no lugar do resumo quebrado — o app. */
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  quebrou: boolean;
}

export class LimiteDeErro extends Component<Props, State> {
  state: State = { quebrou: false };

  static getDerivedStateFromError(): State {
    return { quebrou: true };
  }

  componentDidCatch(erro: unknown) {
    console.error('[MeuDia] o resumo quebrou; liberando a entrada:', erro);
  }

  render() {
    return this.state.quebrou ? this.props.fallback : this.props.children;
  }
}
