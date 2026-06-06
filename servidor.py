"""
Servidor local para el Dashboard Demo Day — eCommerce Institute
Uso: python servidor.py
Abre http://localhost:8080 en tu navegador
"""

import http.server
import socketserver
import json
import os
from urllib.parse import urlparse

PORT = 8080
DIR  = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/save_fichas':
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length)
            try:
                data = json.loads(body)
                out  = os.path.join(DIR, 'fichas.json')
                with open(out, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok": true}')
                print(f"[OK] fichas.json guardado ({len(data.get('fichas', []))} fichas)")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} - {fmt % args}")


if __name__ == '__main__':
    os.chdir(DIR)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n🚀 Dashboard eCommerce Institute corriendo en http://localhost:{PORT}")
        print("   Presioná Ctrl+C para detener.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[Servidor detenido]")
