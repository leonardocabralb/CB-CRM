// ============================================================
// Nomes dos buckets de Storage.
//
// ⚠️ Existe desde a 932 por um motivo bem concreto: `CHAT_MEDIA_BUCKET` morava
// dentro de `message-composer.tsx`, e o disparador das agendadas — que roda no
// SERVIDOR, sem navegador — passou a precisar dele para conferir se o arquivo
// ainda está lá. Importar a constante de um componente cliente arrastaria
// React e `next-intl` para dentro do worker.
// ============================================================

/** Anexos que a equipe manda no chat (migration 023). Público para leitura. */
export const CHAT_MEDIA_BUCKET = 'chat-media';
