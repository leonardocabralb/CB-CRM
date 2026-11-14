#!/usr/bin/env python3
"""
Exporta UM cliente do CRM para uma pasta, pela API pública (/api/v1): a
conversa do WhatsApp em ordem (com a transcrição dos áudios), os arquivos dela
e das anotações internas, os campos, o funil, as anotações, as tarefas e o
histórico de automações.

Uso:
    python3 exportar_cliente.py "<nome, telefone ou id do cliente>" "<pasta dos clientes>"

A pasta do cliente é criada dentro da pasta dos clientes com o nome dele no
CRM. Numa segunda vez, o script acha a mesma pasta (mesmo renomeada) e baixa só
o que é novo. Se já existe uma pasta com esse nome que não é deste cliente (de
um homônimo, ou feita à mão), nada é gravado nela: vira "Nome (2)", com aviso.

Configuração (a chave nunca vai na linha de comando nem na conversa):
    CRM_URL       endereço do CRM (ou "url" no config.json ao lado deste script)
    CRM_API_KEY   a chave de API (ou o arquivo ~/.crm-api-key, só com a chave)

O que fica na pasta do cliente:
    conversa.md         a conversa inteira, do mais antigo ao mais novo
    resumo-do-crm.md    funil, etiquetas, campos, anotações, tarefas, automações
    arquivos.json       cada arquivo: de onde veio, quando, quem mandou, se baixou
    cliente.json        tudo o que foi lido, para consulta
    originais/          os arquivos como vieram (AAAA-MM-DD_HHhMM_<nome original>)
    .exportacao.json    controle: rodar de novo baixa só o que é novo

Códigos de saída: 0 pronto · 2 configuração · 3 cliente não encontrado ·
4 mais de um cliente (a lista sai em JSON; rode de novo com o id) · 5 erro da API.

Só lê: nada é escrito no CRM. Campo cujo nome tem "senha" não vem para a pasta.
Só biblioteca padrão do Python 3.8+.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

PAUSA_ENTRE_CHAMADAS = 0.55  # ~109 chamadas por minuto: abaixo do limite de 120 da chave
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?(/|$)")  # só para teste
AGENTE = "exportar-cliente/1.0"


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    """Recusa TODO redirecionamento (vira erro HTTP 3xx). O urllib copia os
    cabeçalhos para o destino — o `Authorization` com a chave iria junto, para
    qualquer endereço, até de https para http —, e o download pularia para um
    endereço que `endereco_aceito` nunca viu. A API e o armazenamento do CRM
    respondem direto."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


ABRIR = urllib.request.build_opener(_SemRedirecionar())

try:  # horário de Brasília; sem a base de fusos (Windows), UTC-3 fixo
    from zoneinfo import ZoneInfo

    FUSO = ZoneInfo("America/Sao_Paulo")
except Exception:  # pragma: no cover
    FUSO = timezone(timedelta(hours=-3))

try:  # o Windows imprime em cp1252 quando a saída é capturada
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # pragma: no cover
    pass


def sair(codigo: int, mensagem: str) -> None:
    print(mensagem, file=sys.stderr)
    sys.exit(codigo)


def endereco_aceito(url: str) -> bool:
    return url.startswith("https://") or bool(LOCAL.match(url))


def ler_configuracao() -> tuple[str, str]:
    base = os.environ.get("CRM_URL", "").strip()
    config = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    if not base and os.path.isfile(config):
        with open(config, encoding="utf-8") as f:
            base = str(json.load(f).get("url") or "").strip()
    if not endereco_aceito(base):
        sair(2, "Falta o endereço do CRM: CRM_URL ou \"url\" no config.json ao lado do script "
                "(ex.: https://crm.exemplo.com.br).")
    chave = os.environ.get("CRM_API_KEY", "").strip()
    arquivo = os.path.expanduser("~/.crm-api-key")
    if not chave and os.path.isfile(arquivo):
        with open(arquivo, encoding="utf-8") as f:
            chave = f.read().strip()
    if not chave:
        sair(2, "Falta a chave: crie o arquivo ~/.crm-api-key só com a chave (veja o LEIA-ME).")
    return base.rstrip("/"), chave


def sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    ).lower()


def nome_seguro(texto: str, limite: int = 120) -> str:
    """Nome que qualquer sistema aceita: sem barra, sem caractere proibido."""
    texto = unicodedata.normalize("NFC", texto or "").strip()
    texto = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", texto)
    texto = re.sub(r"\s+", " ", texto).strip(" .")
    if len(texto) > limite:
        raiz, ext = os.path.splitext(texto)
        texto = raiz[: limite - len(ext)] + ext if len(ext) <= 8 else texto[:limite]
    return texto or "arquivo"


def instante(iso: str | None) -> datetime | None:
    """ISO do banco → horário de Brasília. O Python < 3.11 só aceita a fração
    de segundo com 3 ou 6 dígitos, e o banco manda de 1 a 6."""
    if not iso:
        return None
    texto = iso.strip().replace("Z", "+00:00").replace(" ", "T", 1)
    texto = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], texto)
    try:
        momento = datetime.fromisoformat(texto)
    except ValueError:
        return None
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(FUSO)


def quando(iso: str | None, formato: str = "%d/%m/%Y %H:%M") -> str:
    momento = instante(iso)
    return momento.strftime(formato) if momento else "—"


def ordem(iso: str | None) -> float:
    momento = instante(iso)
    return momento.timestamp() if momento else 0.0


class SemPermissao(Exception):
    pass


class Api:
    def __init__(self, base: str, chave: str):
        self.base = base
        self._chave = chave  # nunca impressa
        self.chamadas = 0
        self.cortes: list[str] = []

    def get(self, caminho: str, params: dict | None = None) -> dict:
        url = self.base + caminho
        if params:
            limpos = {k: v for k, v in params.items() if v is not None}
            if limpos:
                url += "?" + urllib.parse.urlencode(limpos)
        for tentativa in range(5):
            if self.chamadas:
                time.sleep(PAUSA_ENTRE_CHAMADAS)
            self.chamadas += 1
            pedido = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {self._chave}",
                "Accept": "application/json",
                "User-Agent": AGENTE,
            })
            try:
                with ABRIR.open(pedido, timeout=60) as resposta:
                    return json.loads(resposta.read().decode("utf-8"))
            except urllib.error.HTTPError as erro:
                try:
                    corpo = json.loads(erro.read().decode("utf-8"))
                except Exception:
                    corpo = {}
                detalhe = corpo.get("error") if isinstance(corpo.get("error"), dict) else {}
                codigo = detalhe.get("code", "")
                mensagem = detalhe.get("message", "")
                if erro.code == 429 and tentativa < 4:
                    time.sleep(min(int(erro.headers.get("Retry-After") or 20), 60))
                    continue
                if erro.code >= 500 and tentativa < 2:
                    time.sleep(3 * (tentativa + 1))
                    continue
                if erro.code == 401:
                    sair(5, "A chave foi recusada (401): errada, revogada ou vencida, ou o funcionário "
                            "dono dela foi suspenso ou saiu da equipe. Peça outra ao administrador.")
                if erro.code == 403:
                    raise SemPermissao(f"{codigo} {mensagem}".strip())
                if erro.code == 404:
                    return {"_404": True}
                sair(5, f"Erro da API em {caminho}: {erro.code} {codigo} {mensagem}".strip())
            except urllib.error.URLError as erro:
                if tentativa < 2:
                    time.sleep(3 * (tentativa + 1))
                    continue
                sair(5, f"Não consegui falar com o CRM em {self.base}: {erro.reason}")
        sair(5, f"A API não respondeu em {caminho} depois de várias tentativas.")
        return {}

    def todas(self, caminho: str, params: dict | None = None, teto: int | None = None,
              rotulo: str = "") -> list:
        """Todas as páginas. Sem `teto`, até o fim. Com `teto`, os mais
        recentes até ele — e o corte vira aviso em `self.cortes`, nunca
        silêncio (a lista vem do mais novo ao mais antigo)."""
        itens: list = []
        cursor = None
        while True:
            pagina = self.get(caminho, {**(params or {}), "limit": 100, "cursor": cursor})
            if pagina.get("_404"):
                return itens
            itens.extend(pagina.get("data") or [])
            cursor = (pagina.get("meta") or {}).get("next_cursor")
            if not cursor:
                return itens
            if teto is not None and len(itens) >= teto:
                self.cortes.append(f"{rotulo or caminho}: só os {teto} mais recentes; os mais antigos "
                                   "ficaram de fora desta exportação.")
                return itens[:teto]


def baixar(url: str | None, destino: str) -> str | None:
    """Baixa para `destino`. Devolve None se baixou, ou o motivo de não ter baixado."""
    if not url:
        return "o CRM não tem o arquivo"
    if not endereco_aceito(url):
        return "endereço que só abre com login no CRM"
    parcial = destino + ".parcial"
    try:
        pedido = urllib.request.Request(url, headers={"User-Agent": AGENTE})
        with ABRIR.open(pedido, timeout=180) as resposta, open(parcial, "wb") as f:
            while True:
                bloco = resposta.read(1 << 16)
                if not bloco:
                    break
                f.write(bloco)
        os.replace(parcial, destino)
        return None
    except Exception as erro:  # o arquivo pode ter sumido do armazenamento
        if os.path.exists(parcial):
            os.remove(parcial)
        codigo = getattr(erro, "code", None)
        return f"falhou ao baixar: {codigo or erro.__class__.__name__}"


def termo_de_busca(termo: str) -> str:
    """Telefone digitado com máscara vira só dígitos (o CRM guarda só dígitos)."""
    termo = termo.strip()
    if re.fullmatch(r"[\d\s()+\-.]+", termo) and len(re.sub(r"\D", "", termo)) >= 8:
        return re.sub(r"\D", "", termo)
    return termo


def achar_cliente(api: Api, termo: str) -> dict:
    termo = termo.strip()
    if UUID.match(termo):
        contato = api.get(f"/api/v1/contacts/{termo}")
        if contato.get("_404"):
            sair(3, "Cliente não encontrado com esse id (ou ele está fora dos funis desta chave).")
        return contato["data"]
    achados = api.get("/api/v1/contacts", {"search": termo_de_busca(termo), "limit": 25}).get("data") or []
    if not achados:
        sair(3, f'Nenhum cliente encontrado para "{termo}" (ou ele está fora dos funis desta chave).')
    if len(achados) > 1:
        lista = [{"id": c["id"], "nome": c.get("name"), "telefone": c.get("phone"),
                  "etiquetas": [t.get("name") for t in c.get("tags") or []],
                  "no_crm_desde": quando(c.get("created_at"), "%d/%m/%Y")} for c in achados]
        print(json.dumps({"varios": lista, "mais_de_25": len(achados) >= 25}, ensure_ascii=False, indent=2))
        sys.exit(4)
    return achados[0]


QUEM = {"customer": "Cliente", "agent": "Escritório", "bot": "Robô/automação"}
SITUACAO_DO_CARD = {"open": "em aberto", "won": "ganho", "lost": "perdido"}
DESFECHO = {"completed": "concluída", "blocked": "barrada", "failed": "falhou", "interrupted": "interrompida"}
ROTULO = {"image": "🖼️ Imagem", "video": "🎬 Vídeo", "audio": "🎤 Áudio", "document": "📄 Documento"}
COM_ARQUIVO = ("image", "video", "audio", "document")


def com_extensao(nome: str, mime: str | None) -> str:
    if os.path.splitext(nome)[1] or not mime:
        return nome
    extensao = mimetypes.guess_extension(mime.split(";")[0].strip()) or ""
    return nome + {".jpe": ".jpg", ".oga": ".ogg"}.get(extensao, extensao)


def linha_da_mensagem(m: dict, arquivo: str | None, motivo: str | None) -> str:
    quem = QUEM.get(m.get("sender_type") or "", "Escritório")
    tipo = m.get("content_type") or "text"
    texto = (m.get("content_text") or "").strip()
    partes = []
    if tipo == "call":
        partes.append("📞 Ligação de WhatsApp" + (f" — {texto}" if texto else ""))
        texto = ""
    elif tipo == "sticker":
        partes.append("(figurinha)")
        texto = ""
    elif tipo in COM_ARQUIVO or m.get("media_url"):
        rotulo = ROTULO.get(tipo, "📎 Arquivo")
        declarado = (m.get("media_filename") or "").strip()
        if arquivo:
            partes.append(f"{rotulo}: originais/{arquivo}")
        else:  # o nome é o que diz o que pedir de novo ao cliente
            partes.append(f"{rotulo}" + (f' "{declarado}"' if declarado else "")
                          + f" — INDISPONÍVEL ({motivo or 'não baixado'})")
        if tipo == "audio":
            transcricao = (m.get("transcription") or "").strip()
            partes.append(f'transcrição: "{transcricao}"' if transcricao else "sem transcrição")
        if texto and texto != (m.get("media_filename") or ""):
            partes.append(f"legenda: {texto}")
        texto = ""
    if texto:
        partes.append(texto)
    if m.get("status") == "failed" and m.get("sender_type") != "customer":
        partes.append("(não entregue)")
    return f"**{quando(m.get('created_at'), '%H:%M')} · {quem}:** " + " — ".join(partes or ["(vazia)"])


def ler_controle(pasta: str) -> dict | None:
    caminho = os.path.join(pasta, ".exportacao.json")
    if not os.path.isfile(caminho):
        return None
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def pasta_do_cliente(base: str, cliente: dict) -> tuple[str, str | None]:
    """A pasta que já é deste cliente pelo controle (mesmo renomeada), ou uma
    NOVA com o nome dele. Pasta que já existe com esse nome e não é deste
    cliente pelo controle (de outro cliente, ou feita à mão) nunca é usada:
    vira "Nome (2)", "Nome (3)"… — misturar dois clientes homônimos, ou
    sobrescrever o que alguém pôs ali, seria pior. Devolve também o caminho
    da pasta com o nome que foi pulada, para o Claude perguntar à pessoa."""
    if not os.path.isdir(base):
        sair(2, f"A pasta dos clientes não existe: {base}")
    for item in sorted(os.listdir(base)):
        caminho = os.path.join(base, item)
        if os.path.isdir(caminho) and (ler_controle(caminho) or {}).get("cliente_id") == cliente["id"]:
            return caminho, None
    nome = nome_seguro(cliente.get("name") or cliente.get("phone") or "Cliente", 80)
    primeira = candidato = os.path.join(base, nome)
    n = 2
    while os.path.exists(candidato):
        candidato, n = os.path.join(base, f"{nome} ({n})"), n + 1
    return candidato, (primeira if candidato != primeira else None)


def main() -> None:
    if len(sys.argv) != 3:
        sair(2, (__doc__ or "").split("O que fica")[0].strip())
    termo = sys.argv[1]
    base_dos_clientes = os.path.abspath(os.path.expanduser(sys.argv[2]))
    base, chave = ler_configuracao()
    api = Api(base, chave)
    try:
        exportar(api, termo, base_dos_clientes)
    except SemPermissao as erro:
        sair(5, f"A chave não tem a permissão de leitura que a conversa exige ({erro}). "
                "Peça ao administrador as permissões do LEIA-ME.")


def exportar(api: Api, termo: str, base_dos_clientes: str) -> None:
    avisos: list[str] = []

    def opcional(rotulo: str, ler):
        try:
            return ler()
        except SemPermissao as erro:
            avisos.append(f"{rotulo}: a chave não tem permissão ({erro}). Peça ao administrador.")
            return None

    eu = api.get("/api/v1/me").get("data") or {}
    cliente = achar_cliente(api, termo)
    cid = cliente["id"]

    pasta, pulada = pasta_do_cliente(base_dos_clientes, cliente)
    if pulada:
        avisos.append(f'Já existia a pasta "{os.path.basename(pulada)}", que não é desta exportação '
                      f'(feita à mão ou de outro cliente com o mesmo nome). Nada foi gravado nela: a '
                      f'exportação foi para "{os.path.basename(pasta)}".')
    controle_caminho = os.path.join(pasta, ".exportacao.json")
    controle = ler_controle(pasta) or {}

    lidos = opcional("Campos", lambda: api.get(f"/api/v1/contacts/{cid}/custom-fields")) or {}
    campos = [
        c for c in ((lidos.get("data") or {}).get("fields") or [])
        if c.get("value") not in (None, "")
        and not re.search(r"senha|password", sem_acento(f"{c.get('name', '')} {c.get('key', '')}"))
    ]
    funis = {p["id"]: p for p in (opcional("Funis", lambda: api.get("/api/v1/pipelines")) or {}).get("data") or []}
    cards = opcional("Funil", lambda: api.todas("/api/v1/deals", {"contact_id": cid})) or []
    anotacoes = opcional("Anotações", lambda: api.todas("/api/v1/notes", {"contact_id": cid})) or []
    tarefas = opcional("Tarefas", lambda: api.todas("/api/v1/tasks", {"contact_id": cid})) or []
    automacoes = opcional("Automações", lambda: api.todas(
        f"/api/v1/contacts/{cid}/automation-runs", teto=300, rotulo="Automações")) or []
    conversas = api.todas("/api/v1/conversations", {"contact_id": cid})
    mensagens: list = []
    for conversa in conversas:
        mensagens += api.todas(f"/api/v1/conversations/{conversa['id']}/messages")
    mensagens.sort(key=lambda m: (ordem(m.get("created_at")), m.get("id") or ""))
    avisos += api.cortes  # as mensagens não têm teto; um corte em outra lista é dito

    originais = os.path.join(pasta, "originais")
    os.makedirs(originais, exist_ok=True)
    ja_baixados: dict = controle.get("arquivos") or {}
    arquivos: list = []

    def guardar(origem_id: str, url, iso, nome, mime, extra: dict):
        """Baixa uma vez só; rodar de novo reaproveita o que já está na pasta,
        mas só se o arquivo de lá é o MESMO (o endereço sem a consulta): o
        anexo trocado na anotação ou a mídia regravada baixam de novo."""
        fonte = (url or "").split("?")[0]
        anterior = ja_baixados.get(origem_id)
        if (anterior and anterior.get("fonte") == fonte
                and os.path.isfile(os.path.join(originais, anterior["arquivo"]))):
            arquivos.append({**anterior, **extra, "motivo": None, "novo": False})
            return anterior["arquivo"], None
        nome_salvo = nome_seguro(f"{quando(iso, '%Y-%m-%d_%Hh%M')}_{com_extensao(nome or 'arquivo', mime)}")
        raiz, ext = os.path.splitext(nome_salvo)
        destino, n = os.path.join(originais, nome_salvo), 2
        while os.path.exists(destino):
            destino, n = os.path.join(originais, f"{raiz}-{n}{ext}"), n + 1
        motivo = baixar(url, destino)
        # `dia` e `chegou_em` já no horário de Brasília: é deles que sai a data
        # do nome novo (o ISO do banco é UTC e erra o dia depois das 21h)
        info = {"origem_id": origem_id, "fonte": fonte, "dia": quando(iso, "%Y-%m-%d"),
                "chegou_em": quando(iso), "nome_original": nome, "mime": mime,
                "arquivo": None if motivo else os.path.basename(destino)}
        if not motivo:
            ja_baixados[origem_id] = info
        arquivos.append({**info, **extra, "motivo": motivo, "novo": not motivo})
        return info["arquivo"], motivo

    na_conversa: dict = {}
    for m in mensagens:
        tipo = m.get("content_type")
        if tipo in COM_ARQUIVO or (m.get("media_url") and tipo != "sticker"):
            na_conversa[m["id"]] = guardar(
                f"msg:{m['id']}", m.get("media_url"), m.get("created_at"),
                m.get("media_filename") or tipo, m.get("media_mime_type"),
                {"origem": "conversa", "mandado_por": QUEM.get(m.get("sender_type") or "", "Escritório"),
                 "tipo_no_whatsapp": tipo, "legenda": m.get("content_text"),
                 "transcricao": m.get("transcription")})
    for nota in anotacoes:
        for i, anexo in enumerate(nota.get("anexos") or []):
            # pelo endereço, nunca pela posição: tirar um anexo da anotação
            # não pode dar ao seguinte o arquivo baixado do que saiu
            fonte = (anexo.get("url") or "").split("?")[0]
            guardar(f"nota:{nota['id']}:{fonte or i}", anexo.get("url"), nota.get("created_at"),
                    anexo.get("nome"), anexo.get("tipo"),
                    {"origem": "anotação interna", "mandado_por": nota.get("autor_nome") or "Equipe",
                     "texto_da_anotacao": nota.get("texto")})

    with open(controle_caminho, "w", encoding="utf-8") as f:
        json.dump({"cliente_id": cid, "arquivos": ja_baixados}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(pasta, "arquivos.json"), "w", encoding="utf-8") as f:
        json.dump(arquivos, f, ensure_ascii=False, indent=2)

    nome = cliente.get("name") or cliente.get("phone") or "Cliente"
    agora = datetime.now(FUSO).strftime("%d/%m/%Y %H:%M")

    # conversa.md: do mais antigo ao mais novo, um título por dia
    linhas = [f"# Conversa com {nome}" + (f" ({cliente['phone']})" if cliente.get("phone") else ""), ""]
    if mensagens:
        linhas.append(f"Exportada em {agora} · {len(mensagens)} mensagens, de "
                      f"{quando(mensagens[0].get('created_at'), '%d/%m/%Y')} a "
                      f"{quando(mensagens[-1].get('created_at'), '%d/%m/%Y')} (horário de Brasília).")
    else:
        linhas.append(f"Exportada em {agora} · nenhuma mensagem.")
    dia = None
    for m in mensagens:
        rotulo = quando(m.get("created_at"), "%d/%m/%Y")
        if rotulo != dia:
            linhas += ["", f"## {rotulo}", ""]
            dia = rotulo
        arquivo, motivo = na_conversa.get(m["id"], (None, None))
        linhas.append(linha_da_mensagem(m, arquivo, motivo) + "  ")
    with open(os.path.join(pasta, "conversa.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")

    # resumo-do-crm.md: o que o CRM sabe além da conversa
    r = [f"# {nome} — o que o CRM sabe", "", f"Exportado em {agora}.", ""]
    r.append(f"- Telefone: {cliente.get('phone') or '—'}")
    r.append(f"- E-mail: {cliente.get('email') or '—'}")
    r.append(f"- Etiquetas: {', '.join(t.get('name', '') for t in cliente.get('tags') or []) or '—'}")
    r.append(f"- No CRM desde: {quando(cliente.get('created_at'), '%d/%m/%Y')}")
    r += ["", "## Funil", ""]
    for card in cards:
        funil = funis.get(card.get("pipeline_id")) or {}
        etapa = next((s.get("name") for s in funil.get("stages") or [] if s.get("id") == card.get("stage_id")), "?")
        situacao = SITUACAO_DO_CARD.get(card.get("status") or "", card.get("status") or "?")
        r.append(f"- {funil.get('name', '?')} → **{etapa}** ({situacao}), card de "
                 f"{quando(card.get('created_at'), '%d/%m/%Y')}")
    r += [] if cards else ["- Sem card em funil."]
    r += ["", "## Campos preenchidos", ""]
    def valor(c: dict) -> str:
        texto = str(c.get("value"))
        if c.get("type") == "date" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto):
            return "/".join(reversed(texto.split("-")))  # DATE sem fuso: só reordena
        return texto
    r += [f"- {c.get('name')}: {valor(c)}" for c in campos] or ["- Nenhum."]
    r += ["", "## Anotações internas da equipe", ""]
    for nota in sorted(anotacoes, key=lambda n: ordem(n.get("created_at"))):
        anexos = ", ".join(a.get("nome") or "" for a in nota.get("anexos") or [])
        r.append(f"- {quando(nota.get('created_at'))} · {nota.get('autor_nome') or 'Equipe'}: "
                 f"{(nota.get('texto') or '').strip()}" + (f" (anexos: {anexos})" if anexos else ""))
    r += [] if anotacoes else ["- Nenhuma."]
    r += ["", "## Tarefas", ""]
    for t in sorted(tarefas, key=lambda t: t.get("vence_em") or ""):
        feita = "x" if t.get("status") == "concluida" else " "
        prazo = "/".join(reversed((t.get("vence_em") or "").split("-"))) or "—"
        r.append(f"- [{feita}] {t.get('titulo')} — prazo {prazo}"
                 f" · responsável {t.get('responsavel_nome') or '—'}")
    r += [] if tarefas else ["- Nenhuma."]
    r += ["", "## Automações que rodaram (as mais recentes primeiro)", ""]
    for a in automacoes[:40]:
        r.append(f"- {quando(a.get('started_at'))} · {a.get('automation_name') or '?'} → "
                 f"{DESFECHO.get(a.get('outcome') or '', a.get('outcome') or 'em andamento')}"
                 + (f" (interrompida: {a['interrupted_by']})" if a.get("interrupted_by") else ""))
    r += [] if automacoes else ["- Nenhuma."]
    faltando = [a for a in arquivos if not a.get("arquivo")]
    r += ["", "## Arquivos", "",
          f"- {len(arquivos) - len(faltando)} em originais/; {len(faltando)} sem arquivo disponível no CRM."]
    if avisos:
        r += ["", "## Avisos da exportação", ""] + [f"- {a}" for a in avisos]
    with open(os.path.join(pasta, "resumo-do-crm.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(r) + "\n")

    with open(os.path.join(pasta, "cliente.json"), "w", encoding="utf-8") as f:
        json.dump({"exportado_em": agora, "funis_da_chave": (eu.get("key") or {}).get("pipeline_ids"),
                   "cliente": cliente, "campos": campos, "cards": cards, "anotacoes": anotacoes,
                   "tarefas": tarefas, "automacoes": automacoes, "conversas": conversas,
                   "total_de_mensagens": len(mensagens), "avisos": avisos},
                  f, ensure_ascii=False, indent=2)

    novos = sum(1 for a in arquivos if a.get("novo"))
    print(json.dumps({"pronto": True, "cliente": nome, "cliente_id": cid, "pasta": pasta,
                      "mensagens": len(mensagens), "arquivos_novos": novos,
                      "arquivos_que_ja_estavam": len(arquivos) - len(faltando) - novos,
                      "arquivos_indisponiveis": len(faltando), "avisos": avisos,
                      "chamadas_a_api": api.chamadas}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
