// ============================================================
// O glifo do WhatsApp, inline.
//
// `lucide-react` não traz ícones de marca (só `message-circle-*`), e o
// operador pediu explicitamente o símbolo do WhatsApp — é como ele reconhece
// "isto é uma conexão de WhatsApp" sem ler nada. Um `<path>` num componente
// local resolve sem dependência nova.
//
// `currentColor` de propósito: quem decide a cor é o estado de saúde, no
// componente que usa isto.
// ============================================================

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.05 2.5A9.45 9.45 0 0 0 4 16.86L2.55 22.16l5.43-1.424A9.45 9.45 0 1 0 12.05 2.5zm0 1.75a7.7 7.7 0 1 1-3.92 14.33l-.28-.166-3.22.845.86-3.14-.183-.29A7.7 7.7 0 0 1 12.05 4.25z" />
    </svg>
  );
}
