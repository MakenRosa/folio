from pathlib import Path

from pypdf import PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)


def create(name, pages):
    document = canvas.Canvas(str(FIXTURES / name), pagesize=(595, 842))
    document.setTitle(name[:-4])
    document.setAuthor("Fólio - testes locais")
    lines = [
        "Ler e abrir uma janela para outras formas de ver o mundo.",
        "Entre uma pagina e outra, ha um lugar para as nossas ideias.",
        "Este documento permite testar busca, selecao, zoom e marcadores.",
        "A biblioteca guarda uma copia independente de cada arquivo.",
        "Sua leitura continua exatamente de onde voce parou.",
    ]
    for page in range(1, pages + 1):
        document.setFillColor(HexColor("#f9f7f0"))
        document.rect(0, 0, 595, 842, fill=1, stroke=0)
        document.setFillColor(HexColor("#3f6554"))
        document.setFont("Helvetica", 10)
        document.drawString(55, 790, "F O L I O   /   C A D E R N O   D E   L E I T U R A")
        document.setFont("Times-Roman", 34)
        document.drawString(55, 720, "O tempo de uma leitura")
        document.setFillColor(HexColor("#6a796d"))
        document.setFont("Helvetica", 11)
        document.drawString(55, 688, f"Capitulo {page:02d}  /  Um espaco para desacelerar")
        document.bookmarkPage(f"p{page}")
        if page <= 12:
            document.addOutlineEntry(f"Capitulo {page}: leitura e ideias", f"p{page}", 0)
        document.setFillColor(HexColor("#2b362f"))
        document.setFont("Times-Roman", 12)
        for index in range(18):
            document.drawString(55, 635 - index * 24, lines[index % len(lines)])
        document.setFillColor(HexColor("#d9e4d4"))
        document.roundRect(55, 107, 485, 65, 8, fill=1, stroke=0)
        document.setFillColor(HexColor("#3f6554"))
        document.setFont("Times-Italic", 15)
        document.drawString(75, 134, "Uma pagina de cada vez. Uma ideia de cada vez.")
        document.setFont("Helvetica", 9)
        document.drawString(55, 52, "Documento de teste local - sem dados pessoais")
        document.drawRightString(540, 52, str(page))
        document.showPage()
    document.save()


create("Caderno de leitura.pdf", 12)
create("Livro extenso - 300 paginas.pdf", 300)
writer = PdfWriter()
writer.append(str(FIXTURES / "Caderno de leitura.pdf"))
writer.encrypt("lume-teste")
writer.write(str(FIXTURES / "Documento protegido.pdf"))
(FIXTURES / "Invalido.pdf").write_bytes(b"not a pdf")
(FIXTURES / "Corrompido.pdf").write_bytes(b"%PDF-1.7\nnot a valid document structure")
print("PDFs artificiais criados:", FIXTURES)
