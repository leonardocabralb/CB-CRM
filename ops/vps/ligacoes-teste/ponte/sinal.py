#!/usr/bin/env python3
"""Sinalização do Teste B (docs/PLANO-ligar-pelo-crm.md, Fase 2).

Troca UMA oferta e UMA resposta WebRTC entre a página do atendente e a
página-ponte (aba do Chrome da máquina), por HTTP simples: cada lado espera
juntar os candidatos de rede antes de mandar, então não há troca aos pedaços.
Serve também as duas páginas e recebe as linhas de diagnóstico delas (/log),
que saem no log do contêiner.

Só para o teste: SEM autenticação. A porta é publicada só no 127.0.0.1 da
VPS, mas qualquer processo DA VPS alcança o contêiner pela bridge da Docker
(medido): por isso o contêiner fica parado entre as sessões de teste. Só
biblioteca padrão.
"""
import json
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PASTA = Path(__file__).resolve().parent
# Uma oferta vale por 60 s (o atendente espera a resposta por 30 s): uma ponte
# recarregada não responde a uma oferta velha.
VALIDADE_DA_OFERTA_S = 60
# Um SDP tem poucos KB; o teto barra corpo absurdo.
TETO_DO_CORPO = 256 * 1024

trava = threading.Lock()
# O número começa no relógio (ms): reiniciar a sinalização não faz a ponte,
# que lembra o último número visto, ignorar as ofertas novas.
estado = {"oferta": None, "resposta": None, "seq": int(time.time() * 1000)}


def log(*partes):
    print(time.strftime("%H:%M:%S"), *partes, flush=True)


class PedidoRuim(Exception):
    def __init__(self, codigo, motivo):
        super().__init__(motivo)
        self.codigo = codigo


class Sinal(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PASTA), **kwargs)

    def log_message(self, *args):  # sem uma linha por GET
        pass

    def _json(self, codigo, corpo=None):
        dados = b"" if corpo is None else json.dumps(corpo).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        if dados:
            self.wfile.write(dados)

    def _corpo(self):
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise PedidoRuim(400, "Content-Length inválido")
        if tamanho > TETO_DO_CORPO:
            raise PedidoRuim(413, "corpo grande demais")
        return self.rfile.read(tamanho) if tamanho > 0 else b""

    def _json_do_corpo(self):
        try:
            return json.loads(self._corpo())
        except (ValueError, UnicodeDecodeError):
            raise PedidoRuim(400, "JSON inválido")

    @staticmethod
    def _inteiro(consulta, nome):
        try:
            return int(consulta.get(nome, ["0"])[0])
        except ValueError:
            raise PedidoRuim(400, f"{nome} inválido")

    def do_GET(self):
        try:
            url = urlparse(self.path)
            consulta = parse_qs(url.query)
            if url.path == "/oferta":
                depois = self._inteiro(consulta, "depois")
                with trava:
                    oferta = estado["oferta"]
                    respondida = estado["resposta"] is not None
                if (
                    oferta
                    and oferta["id"] > depois
                    and not respondida
                    and time.time() - oferta["em"] < VALIDADE_DA_OFERTA_S
                ):
                    return self._json(200, {"id": oferta["id"], "sdp": oferta["sdp"]})
                return self._json(204)
            if url.path == "/resposta":
                pedido = self._inteiro(consulta, "id")
                with trava:
                    resposta = estado["resposta"]
                if resposta and resposta["id"] == pedido:
                    return self._json(200, resposta)
                return self._json(204)
            return super().do_GET()
        except PedidoRuim as erro:
            return self._json(erro.codigo, {"erro": str(erro)})

    def do_POST(self):
        try:
            url = urlparse(self.path)
            if url.path == "/oferta":
                sdp = self._json_do_corpo().get("sdp")
                if not isinstance(sdp, str) or not sdp:
                    raise PedidoRuim(400, "sdp ausente")
                with trava:
                    estado["seq"] += 1
                    estado["oferta"] = {"id": estado["seq"], "sdp": sdp, "em": time.time()}
                    estado["resposta"] = None
                    numero = estado["seq"]
                log("oferta", numero, "recebida do atendente")
                return self._json(200, {"id": numero})
            if url.path == "/resposta":
                corpo = self._json_do_corpo()
                try:
                    numero = int(corpo["id"])
                    sdp = corpo["sdp"]
                except (KeyError, TypeError, ValueError):
                    raise PedidoRuim(400, "id ou sdp ausente")
                with trava:
                    oferta = estado["oferta"]
                    if not oferta or oferta["id"] != numero:
                        raise PedidoRuim(409, "resposta para oferta que não é a atual")
                    estado["resposta"] = {"id": numero, "sdp": sdp}
                log("resposta", numero, "recebida da ponte")
                return self._json(200, {})
            if url.path == "/log":
                origem = self.headers.get("X-Origem", "?")[:20]
                log(f"[{origem}]", self._corpo().decode(errors="replace")[:500])
                return self._json(204)
            return self._json(404)
        except PedidoRuim as erro:
            return self._json(erro.codigo, {"erro": str(erro)})


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    log("sinalização ouvindo na porta", porta)
    ThreadingHTTPServer(("0.0.0.0", porta), Sinal).serve_forever()
