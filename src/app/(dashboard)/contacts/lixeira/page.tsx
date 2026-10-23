import { LixeiraDeContatos } from '@/components/contacts/lixeira/lixeira-de-contatos';

/**
 * A Lixeira de contatos (1097). Só admin — o recorte mora no componente
 * (`useCan('delete-contacts')`, o mesmo poder de excluir); as RPCs conferem
 * admin por dentro.
 *
 * ⚠️ Não é tela NOVA do catálogo de perfis: `telaDoCaminho` a resolve para
 * `contacts` (prefixo `/contacts/`), e o `protectedPaths` do middleware já a
 * cobre pelo mesmo prefixo. Como tela própria do catálogo, nasceria
 * INVISÍVEL para todo perfil já gravado — e quem decide é o papel, não o
 * perfil.
 */
export default function LixeiraDeContatosPage() {
  return <LixeiraDeContatos />;
}
