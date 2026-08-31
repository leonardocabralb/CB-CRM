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

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { CampoPersonalizadoInput } from '@/components/contacts/campo-personalizado-input';
import { Label } from '@/components/ui/label';
import {
  criarFilaDeGravacao,
  gravaAoEscolher,
  type EstadoDaGravacao,
  type FilaDeGravacao,
} from '@/lib/contacts/salvamento-de-campo';
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
  const [estado, setEstado] = useState<EstadoDaGravacao>('parado');

  /**
   * O que está digitado, em ref, porque a limpeza de desmonte roda fora do
   * render e não enxerga o estado.
   *
   * ⚠️ O rascunho NÃO acompanha a prop `valorSalvo` depois da montagem, de
   * propósito: o dono reescreve o estado dele a cada gravação bem-sucedida, e
   * seguir a prop faria a comparação "mudou?" perseguir o próprio rabo. Por
   * isso **quem monta só pode montar quando os valores já forem deste
   * contato** — é o que `valoresDesteContato` garante nas duas telas.
   */
  const rascunhoRef = useRef(valorSalvo);
  /** O valor de MONTAGEM, para a fila nascer com a régua certa. */
  const valorInicialRef = useRef(valorSalvo);
  const gravarRef = useRef(aoGravar);
  const fieldIdRef = useRef(field.id);
  useEffect(() => {
    gravarRef.current = aoGravar;
    fieldIdRef.current = field.id;
  });

  /**
   * ⚠️ TODA gravação passa pela fila — nunca `aoGravar` direto.
   *
   * Duas requisições concorrentes na mesma linha chegam ao banco fora de
   * ordem, e a antiga chegando por último apaga a edição mais nova, em
   * silêncio. A fila serializa e faz o último valor vencer; ela também guarda
   * o que o banco CONFIRMOU, que é a régua do "mudou?" e da descarga de
   * desmonte.
   *
   * ⚠️ Criada no efeito de MONTAGEM, e não no render: ler `ref.current`
   * durante o render é proibido pelo `react-hooks/refs`, e a fila precisa do
   * `gravarRef` para não envelhecer junto com a prop. Os `?.` dos
   * manipuladores cobrem a janela entre o primeiro render e o efeito —
   * janela em que ninguém consegue focar, muito menos sair de, um campo que
   * acabou de aparecer.
   */
  const filaRef = useRef<FilaDeGravacao | null>(null);
  useEffect(() => {
    const fila = criarFilaDeGravacao(
      valorInicialRef.current,
      (v) => gravarRef.current(fieldIdRef.current, v),
      // O aviso alto do erro é do dono (ele sabe o nome do cliente); aqui o
      // campo só para de dizer "gravando" — spinner eterno seria pior.
      setEstado,
    );
    filaRef.current = fila;
    // ⚠️ A DESCARGA DE DESMONTE — ver o cabeçalho. Pela FILA também: com uma
    // gravação em voo, disparar direto aqui recriaria a corrida que ela
    // existe para impedir; ela mesma pega o pendente na volta. O laço é uma
    // promessa solta e sobrevive ao desmonte, e o `setEstado` que ele fizer
    // depois é inócuo. Em StrictMode o desmonte falso roda com rascunho ===
    // salvo, e a fila ignora o que não mudou.
    return () => {
      fila.enfileirar(rascunhoRef.current);
    };
  }, []);

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
  // Em StrictMode o desmonte falso roda com rascunho === salvo, e a fila
  // ignora o que não mudou — nada é gravado duas vezes.
  const mudou = (v: string) => {
    setRascunho(v);
    rascunhoRef.current = v;
    // Lista: escolher JÁ é o gesto inteiro — o popover fecha e não há blur
    // útil para esperar (ver `gravaAoSair`).
    if (gravaAoEscolher(field.field_type)) filaRef.current?.enfileirar(v);
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
        filaRef.current?.enfileirar(rascunhoRef.current);
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
