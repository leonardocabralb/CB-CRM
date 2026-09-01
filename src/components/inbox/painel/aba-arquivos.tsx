"use client";

// ============================================================
// Aba "Arquivos" do painel — o acervo de anexos DAQUELA conversa.
//
// Serve ao contato e ao grupo com o mesmo componente: ele recebe as
// mensagens por prop e não sabe de quem é a conversa. Foi o que permitiu o
// painel do grupo — que até aqui não tinha aba nenhuma — ganhar a feature
// sem duplicar nada.
//
// ⚠️ Nenhuma consulta aqui. O fio já carrega a conversa inteira e a página
// do inbox já guarda o array; ver o aviso de paginação em `lib/media/anexos`.
//
// Clicar em mídia abre o MESMO visualizador do fio (com giro e zoom, que é
// para o que serve foto de documento tirada deitada). São duas INSTÂNCIAS do
// mesmo componente, nunca dois visualizadores diferentes — a distinção que a
// CLAUDE.md cobra ao falar do lightbox do upstream.
// ============================================================

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Mic, Paperclip, Play } from "lucide-react";

import { coletarAnexos, filtrarPorTipo, type Anexo } from "@/lib/media/anexos";
import { GaleriaDoFio } from "../media-gallery";
import type { Message } from "@/types";

interface AbaArquivosProps {
  /** O fio inteiro, como a página já o tem em estado. */
  messages: Message[];
  /**
   * A carga do fio ainda está em curso?
   *
   * ⚠️ Obrigatório, e não opcional com padrão `false`: sem ele o estado vazio
   * vira uma AFIRMAÇÃO falsa. `messages` chega `[]` durante a carga, e a
   * conversa com 93 documentos exibia "Nenhum arquivo nesta conversa" por um
   * segundo. É a mesma família do vazio de `useChannels` virando "sessão
   * expirada" — vazio-durante-a-carga é LACUNA, vazio-com-resposta é
   * conhecimento, e só quem chama sabe distinguir os dois.
   */
  carregando: boolean;
}

export function AbaArquivos({ messages, carregando }: AbaArquivosProps) {
  const t = useTranslations("Inbox.arquivos");
  const anexos = useMemo(() => coletarAnexos(messages), [messages]);

  /**
   * `messages.id` da mídia aberta no visualizador; `null` = fechado.
   *
   * Identidade estável, nunca o índice: o realtime insere linha no fio a
   * qualquer momento, e um índice passaria a apontar para outra foto em
   * silêncio — a mesma regra que a galeria do fio já segue.
   */
  const [abertaEm, setAbertaEm] = useState<string | null>(null);

  const midia = useMemo(() => filtrarPorTipo(anexos, "midia"), [anexos]);
  const documentos = useMemo(
    () => filtrarPorTipo(anexos, "documento"),
    [anexos],
  );
  const audios = useMemo(() => filtrarPorTipo(anexos, "audio"), [anexos]);

  // ⚠️ Antes do estado vazio, sempre. Ver `carregando` nas props.
  if (carregando) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  if (anexos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Paperclip className="text-muted-foreground/50 mb-2 h-8 w-8" />
        <p className="text-muted-foreground text-sm">{t("vazio")}</p>
        <p className="text-muted-foreground text-xs">{t("vazioDica")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {midia.length > 0 && (
        <Secao titulo={t("midia")} contagem={midia.length}>
          {/* Grade de 3: no painel de 360px dá miniatura de ~100px, que é o
              suficiente para reconhecer a foto sem abrir. */}
          <div className="grid grid-cols-3 gap-1.5">
            {midia.map((anexo) => (
              <MiniaturaDeMidia
                key={anexo.messageId}
                anexo={anexo}
                rotuloVideo={t("video")}
                onAbrir={() => setAbertaEm(anexo.messageId)}
              />
            ))}
          </div>
        </Secao>
      )}

      {documentos.length > 0 && (
        <Secao titulo={t("documentos")} contagem={documentos.length}>
          <ul className="space-y-1">
            {documentos.map((anexo) => (
              <LinhaDeArquivo
                key={anexo.messageId}
                anexo={anexo}
                icone={
                  <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                }
                t={t}
              />
            ))}
          </ul>
        </Secao>
      )}

      {audios.length > 0 && (
        <Secao titulo={t("audios")} contagem={audios.length}>
          <ul className="space-y-1">
            {audios.map((anexo) => (
              <LinhaDeArquivo
                key={anexo.messageId}
                anexo={anexo}
                icone={
                  <Mic className="text-muted-foreground h-4 w-4 shrink-0" />
                }
                // ⚠️ NUNCA o nome do arquivo aqui: nota de voz não tem nome, e
                // o WhatsApp entrega o id hexadecimal do objeto
                // (`3A0B20C39A96D7D3761A.oga`). A transcrição (943) é o único
                // rótulo que diz o que a gravação contém; sem ela, um rótulo
                // genérico e a data, que é mais honesto que o hexadecimal.
                rotulo={anexo.transcricao ?? t("audioSemTranscricao")}
                esmaecido={!anexo.transcricao}
                t={t}
              />
            ))}
          </ul>
        </Secao>
      )}

      {/* ⚠️ Recebe `messages`, e não `midia`: a galeria monta a própria lista
          com `collectMediaGallery`, e as duas precisam concordar sobre O QUE
          está na sequência — senão as setas ‹ › andariam num conjunto e o
          clique teria vindo de outro. Como as duas partem do mesmo fio e a
          galeria só aceita imagem e vídeo, a sequência é a mesma. */}
      <GaleriaDoFio
        messages={messages}
        abertaEm={abertaEm}
        onIrPara={setAbertaEm}
        onFechar={() => setAbertaEm(null)}
      />
    </div>
  );
}

function Secao({
  titulo,
  contagem,
  children,
}: {
  titulo: string;
  contagem: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-2 flex items-baseline gap-1.5 text-xs font-medium tracking-wide uppercase">
        {titulo}
        <span className="text-muted-foreground/70 tabular-nums">
          {contagem}
        </span>
      </h3>
      {children}
    </section>
  );
}

function MiniaturaDeMidia({
  anexo,
  rotuloVideo,
  onAbrir,
}: {
  anexo: Anexo;
  rotuloVideo: string;
  onAbrir: () => void;
}) {
  const ehVideo = anexo.contentType === "video";
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={anexo.nome}
      className="bg-muted focus-visible:ring-ring group relative aspect-square overflow-hidden rounded focus-visible:ring-2 focus-visible:outline-none"
    >
      {ehVideo ? (
        // Vídeo não vira `<img>`: o poster exigiria decodificar o arquivo.
        // O ícone já diz o que é, e o clique abre o player de verdade.
        <span className="flex h-full w-full items-center justify-center">
          <Play className="text-muted-foreground h-5 w-5" />
        </span>
      ) : (
        // `<img>` cru, como a bolha: a URL é do bucket ou do proxy, e o
        // `next/image` exigiria declarar cada host remoto no next.config.
        <img
          src={anexo.url}
          alt={anexo.nome}
          loading="lazy"
          className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
        />
      )}
      {ehVideo && (
        <span className="bg-background/80 absolute bottom-0.5 left-0.5 rounded px-1 text-[10px]">
          {rotuloVideo}
        </span>
      )}
    </button>
  );
}

function LinhaDeArquivo({
  anexo,
  icone,
  rotulo,
  esmaecido,
  t,
}: {
  anexo: Anexo;
  icone: React.ReactNode;
  /** O que mostrar. Padrão: o nome do arquivo (documento). */
  rotulo?: string;
  /** Rótulo genérico (áudio sem transcrição) — não compete com os de verdade. */
  esmaecido?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const texto = rotulo ?? anexo.nome;
  return (
    <li>
      <a
        href={anexo.url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:bg-muted flex items-center gap-2 rounded px-2 py-1.5"
      >
        {icone}
        {/* `min-w-0` é o que faz o `truncate` valer dentro do flex: sem ele o
            item nasce com `min-width:auto` e o nome longo estica a linha. */}
        <span className="min-w-0 flex-1">
          <span
            className={
              esmaecido
                ? "text-muted-foreground block truncate text-sm italic"
                : "block truncate text-sm"
            }
            title={texto}
          >
            {texto}
          </span>
          <span className="text-muted-foreground block text-xs">
            {t(anexo.doCliente ? "recebido" : "enviado")} ·{" "}
            {new Date(anexo.createdAt).toLocaleDateString(undefined, {
              day: "2-digit",
              month: "2-digit",
              year: "2-digit",
            })}
          </span>
        </span>
      </a>
    </li>
  );
}
