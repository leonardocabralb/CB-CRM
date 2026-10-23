'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * O encoder Ogg/Opus que roda no navegador — o MESMO do compositor
 * (`/opus/`, vendido do opus-recorder; fora do `no-store` das páginas,
 * `deploy.md`). Gravar em Ogg/Opus no próprio navegador dispensa conversão no
 * servidor, e o arquivo cabe na lista exata do bucket (`audio/ogg`).
 */
const CAMINHO_DO_ENCODER = '/opus/encoderWorker.min.js';

/**
 * `cancelado` = parou, descartou ou a caixa sumiu enquanto o microfone era
 * pedido: quem chamou não avisa nada (não houve recusa).
 */
export type InicioDaGravacao = 'gravando' | 'sem-suporte' | 'negado' | 'cancelado';

/**
 * Quanto se espera o encoder devolver a gravação parada. Ele responde em
 * milissegundos; o prazo só existe para um encoder que morreu não deixar a
 * caixa "finalizando" (e o Salvar desligado) para sempre.
 */
const PRAZO_DA_ENTREGA_MS = 10_000;

/**
 * Gravador de voz da caixa de anotação (1102).
 *
 * CÓPIA do gravador do compositor (`message-composer.tsx`, arquivo do
 * upstream: mexer nele é superfície de conflito no merge), com o que a caixa
 * precisa a mais:
 *
 * - ⚠️⚠️ SOLTA O MICROFONE QUANDO A CAIXA SOME. No fio a caixa fecha ao
 *   trocar de conversa; no painel e no grupo ela remonta (`key`) — nos dois
 *   casos o desmonte DESCARTA a gravação: ninguém segue gravando, na conversa
 *   de outro cliente, uma fala sobre este. Os bytes que o encoder ainda
 *   devolver são ignorados.
 * - O microfone pedido e concedido DEPOIS do desmonte (o pedido de permissão
 *   fica aberto enquanto a pessoa troca de conversa) é fechado na hora: cada
 *   início leva uma GERAÇÃO, e parar, descartar e desmontar a avançam.
 * - O teto (`maxSegundos`, 5 min como o compositor) para e ENTREGA a
 *   gravação, no próprio tique do relógio — nunca por efeito.
 * - ⚠️ `finalizando`: de `parar` (ou do teto) até os bytes chegarem pelo
 *   `ondataavailable`, o áudio ainda NÃO está na lista de quem chamou. Salvar
 *   nesse meio-tempo gravaria a anotação sem ele, e o áudio, chegando com o
 *   salvar em voo, se perderia: quem chama segura o Salvar enquanto isso.
 *
 * `aoGravar` recebe o arquivo Ogg/Opus inteiro (`streamPages: false`).
 */
export function useGravadorDeVoz({
  aoGravar,
  maxSegundos,
}: {
  aoGravar: (bytes: Uint8Array) => void;
  maxSegundos: number;
}) {
  const [gravando, setGravando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [segundos, setSegundos] = useState(0);

  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  // O gravador parado que ainda está ENTREGANDO os bytes, e o prazo dele.
  const finalizandoRef = useRef<import('opus-recorder').default | null>(null);
  const prazoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relogioRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contagemRef = useRef(0);
  const geracaoRef = useRef(0);
  // Os gravadores DESCARTADOS, cada um por si: o encoder devolve os bytes
  // depois do `stop()`, e um sinal só (como o do compositor) seria religado
  // por uma gravação nova começada nesse meio-tempo — a descartada entraria.
  const descartadosRef = useRef(new WeakSet<import('opus-recorder').default>());
  const aoGravarRef = useRef(aoGravar);
  useEffect(() => {
    aoGravarRef.current = aoGravar;
  });

  /** A entrega DESTE gravador acabou (chegou, falhou ou estourou o prazo). */
  const entregou = useCallback((recorder: import('opus-recorder').default) => {
    if (finalizandoRef.current !== recorder) return;
    finalizandoRef.current = null;
    if (prazoRef.current !== null) {
      clearTimeout(prazoRef.current);
      prazoRef.current = null;
    }
    setFinalizando(false);
  }, []);

  const encerrar = useCallback(
    (descartando: boolean) => {
      geracaoRef.current += 1;
      if (relogioRef.current !== null) {
        clearInterval(relogioRef.current);
        relogioRef.current = null;
      }
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) return;
      // `stop()` solta o microfone (as trilhas do fluxo) por dentro do
      // opus-recorder e, gravando, faz o encoder devolver o arquivo pelo
      // `ondataavailable`. Com o microfone ainda sendo pedido ele não faz
      // nada: quem fecha é o `iniciar`, pela geração.
      if (descartando) {
        descartadosRef.current.add(recorder);
        void recorder.stop().catch(() => {});
        return;
      }
      finalizandoRef.current = recorder;
      setFinalizando(true);
      prazoRef.current = setTimeout(() => entregou(recorder), PRAZO_DA_ENTREGA_MS);
      // O `ondataavailable` vem ANTES de o `stop()` resolver (o "done" do
      // encoder); o `finally` só cobre a gravação que não devolveu nada.
      void recorder
        .stop()
        .catch(() => {})
        .finally(() => entregou(recorder));
    },
    [entregou]
  );

  /** Para e ENTREGA a gravação (`aoGravar`). */
  const parar = useCallback(() => {
    setGravando(false);
    encerrar(false);
  }, [encerrar]);

  /** Para e JOGA FORA o que foi gravado. */
  const descartar = useCallback(() => {
    setGravando(false);
    encerrar(true);
  }, [encerrar]);

  const iniciar = useCallback(async (): Promise<InicioDaGravacao> => {
    if (recorderRef.current) return 'gravando';
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      return 'sem-suporte';
    }
    const geracao = ++geracaoRef.current;
    let recorder: import('opus-recorder').default | null = null;
    try {
      // O encoder (~400 KB) só carrega quando alguém grava.
      const { default: Recorder } = await import('opus-recorder');
      if (geracao !== geracaoRef.current) return 'cancelado';
      const este = new Recorder({
        encoderPath: CAMINHO_DO_ENCODER,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — afinado para fala
        encoderSampleRate: 48000,
        streamPages: false, // um só callback, com o arquivo inteiro, no stop
      });
      recorder = este;
      este.ondataavailable = (bytes) => {
        if (descartadosRef.current.has(este)) return;
        // Os bytes entram na lista de quem chamou e, no MESMO tique, o
        // "finalizando" acaba: o Salvar volta já com o áudio na lista.
        aoGravarRef.current(bytes);
        entregou(este);
      };
      recorderRef.current = este;
      await este.start();
      // Parou, descartou ou a caixa sumiu enquanto o navegador pedia o
      // microfone: ele acabou de abrir e fecha agora, sem entregar nada.
      if (geracao !== geracaoRef.current) {
        descartadosRef.current.add(este);
        void este.stop().catch(() => {});
        return 'cancelado';
      }
      contagemRef.current = 0;
      setSegundos(0);
      setGravando(true);
      relogioRef.current = setInterval(() => {
        contagemRef.current += 1;
        setSegundos(contagemRef.current);
        if (contagemRef.current >= maxSegundos) {
          setGravando(false);
          encerrar(false);
        }
      }, 1000);
      return 'gravando';
    } catch {
      // O microfone negado (ou o encoder que não carregou): ESTE gravador sai,
      // nunca um mais novo que tenha tomado o lugar no ref.
      if (recorder) {
        descartadosRef.current.add(recorder);
        void recorder.stop().catch(() => {});
        if (recorderRef.current === recorder) recorderRef.current = null;
      }
      return geracao === geracaoRef.current ? 'negado' : 'cancelado';
    }
  }, [encerrar, entregou, maxSegundos]);

  // A caixa sumiu: descarta e solta o microfone — e a gravação parada que
  // ainda estava chegando não entra numa caixa que não existe mais.
  useEffect(() => {
    // O conjunto é o MESMO a vida toda (o ref nunca é reatribuído).
    const descartados = descartadosRef.current;
    return () => {
      encerrar(true);
      const chegando = finalizandoRef.current;
      if (chegando) descartados.add(chegando);
      finalizandoRef.current = null;
      if (prazoRef.current !== null) clearTimeout(prazoRef.current);
    };
  }, [encerrar]);

  return { gravando, finalizando, segundos, iniciar, parar, descartar };
}
