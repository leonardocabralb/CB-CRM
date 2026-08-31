'use client';

// ============================================================
// Um campo personalizado que SALVA SOZINHO (Fase B1).
//
// Embrulha o `CampoPersonalizadoInput` (que continua burro, só desenhando o
// input do tipo certo) e responde por três coisas que as duas telas de edição
// não podem implementar duas vezes: quando gravar, o que já está gravado, e o
// que aconteceu com a última gravação.
//
// ⚠️⚠️ A `key` DE QUEM MONTA ISTO PRECISA INCLUIR O `contact.id`.
// É load-bearing e silencioso: sem ela o React REUSA a instância ao trocar de
// cliente, o rascunho do cliente A sobrevive sob o cabeçalho do B, e a
// descarga de desmonte (abaixo) grava no cliente errado. Com a `key` certa, a
// instância velha é desmontada com as props velhas — que é justamente o que
// faz a descarga acertar o contato de onde o texto veio.
//
// ⚠️ POR QUE HÁ DESCARGA DE DESMONTE
// Desmontar um componente React **não** dispara `blur`. Sem ela, digitar num
// campo e (a) trocar de bloco no menu horizontal, (b) fechar o painel no ✕,
// ou (c) trocar de aba, apagaria o que foi digitado — em silêncio, e sem o
// botão "Salvar campos" para servir de segunda chance. Perder digitação é
// pior que gravar digitação (é a mesma regra que o botão da 966 já seguia ao
// salvar TODOS os campos, e não só os do bloco à vista).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { CampoPersonalizadoInput } from '@/components/contacts/campo-personalizado-input';
import { Label } from '@/components/ui/label';
import { gravaAoEscolher, valorMudou } from '@/lib/contacts/salvamento-de-campo';
import { cn } from '@/lib/utils';
import type { CustomField } from '@/types';

/** Quanto tempo o "Salvo" fica na tela antes de sumir. */
const SUMICO_MS = 2000;

export interface CampoComSalvamentoProps {
  field: CustomField;
  /** O valor gravado, na montagem. */
  valorSalvo: string;
  /**
   * Grava e devolve `true` no sucesso.
   *
   * ⚠️ Quem monta liga o `contact.id` AQUI (`useCallback` sobre ele), e não
   * passa o contato como prop: assim a função que a descarga de desmonte
   * chama é a que nasceu com o contato certo, sem este componente precisar
   * saber que contatos existem.
   */
  aoGravar: (fieldId: string, valor: string) => Promise<boolean>;
  /** Rótulo do campo — fica aqui para o indicador aparecer ao lado dele. */
  rotulo: string;
  /** "Salvo" na língua da tela dona (este módulo não tem i18n, como o input). */
  textoSalvo: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function CampoComSalvamento({
  field,
  valorSalvo,
  aoGravar,
  rotulo,
  textoSalvo,
  disabled,
  placeholder,
  className,
}: CampoComSalvamentoProps) {
  const [rascunho, setRascunho] = useState(valorSalvo);
  const [estado, setEstado] = useState<'parado' | 'gravando' | 'salvo'>('parado');

  /**
   * O que está digitado e o que já foi gravado, em refs, porque a limpeza de
   * desmonte roda fora do render e não enxerga o estado.
   *
   * ⚠️ `salvoRef` NÃO acompanha a prop `valorSalvo` depois da montagem, de
   * propósito: o dono reescreve o estado dele a cada gravação bem-sucedida, e
   * seguir a prop faria a comparação "mudou?" perseguir o próprio rabo. A
   * troca de cliente é resolvida pela `key`, não por sincronia de prop.
   */
  const rascunhoRef = useRef(valorSalvo);
  const salvoRef = useRef(valorSalvo);
  const gravarRef = useRef(aoGravar);
  const fieldIdRef = useRef(field.id);
  useEffect(() => {
    gravarRef.current = aoGravar;
    fieldIdRef.current = field.id;
  });

  const gravar = useCallback(
    async (valor: string) => {
      if (!valorMudou(salvoRef.current, valor)) return;
      setEstado('gravando');
      const ok = await gravarRef.current(fieldIdRef.current, valor);
      if (ok) {
        salvoRef.current = valor;
        setEstado('salvo');
      } else {
        // O aviso alto é do dono (ele sabe o nome do cliente); aqui o campo só
        // para de dizer "gravando" — um spinner eterno seria a pior saída.
        setEstado('parado');
      }
    },
    [],
  );

  // O "Salvo" some sozinho. Sem isto, dez campos preenchidos deixam dez
  // marcas verdes permanentes e a informação vira decoração.
  useEffect(() => {
    if (estado !== 'salvo') return;
    const t = setTimeout(() => setEstado('parado'), SUMICO_MS);
    return () => clearTimeout(t);
  }, [estado]);

  // ⚠️ A DESCARGA DE DESMONTE — ver o cabeçalho. Dispara sem `await` de
  // propósito: o componente já está indo embora e não há a quem contar o
  // resultado; a gravação em si é uma requisição normal e completa sozinha.
  // Em StrictMode o desmonte falso roda com rascunho === salvo, então
  // `valorMudou` devolve false e nada é gravado duas vezes.
  useEffect(() => {
    return () => {
      if (valorMudou(salvoRef.current, rascunhoRef.current)) {
        void gravarRef.current(fieldIdRef.current, rascunhoRef.current);
      }
    };
  }, []);

  const mudou = (v: string) => {
    setRascunho(v);
    rascunhoRef.current = v;
    // Lista: escolher JÁ é o gesto inteiro — o popover fecha e não há blur
    // útil para esperar (ver `gravaAoSair`).
    if (gravaAoEscolher(field.field_type)) void gravar(v);
  };

  return (
    // `onBlur` no CONTÊINER, não no input: o React usa `focusout`, que
    // borbulha — assim vale para qualquer input que o
    // `CampoPersonalizadoInput` resolva desenhar, sem ele precisar aprender
    // uma prop nova.
    <div
      className={cn('space-y-1', className)}
      onBlur={() => {
        if (disabled) return;
        if (gravaAoEscolher(field.field_type)) return;
        void gravar(rascunhoRef.current);
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {/* ⚠️ Sem `capitalize`: o nome do campo já vem escrito como deve
            aparecer, e maiusculizar estragava "utm_source" (regra da 966). */}
        <Label className="text-muted-foreground min-w-0 truncate text-xs">
          {rotulo}
        </Label>
        {estado === 'gravando' && (
          <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />
        )}
        {estado === 'salvo' && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-500">
            <Check className="size-3" />
            {textoSalvo}
          </span>
        )}
      </div>
      <CampoPersonalizadoInput
        field={field}
        value={rascunho}
        onChange={mudou}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}
