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

# Large internal margins reproduce the visible break between book pages.
joined = canvas.Canvas(str(FIXTURES / "Paginas com margens.pdf"), pagesize=(595, 842))
for number in range(1, 7):
    if number != 5:
        joined.setFont("Times-Roman", 17)
        for line in range(15):
            joined.drawString(65, 650 - line * 28, f"Pagina {number:02d}, linha {line + 1:02d}: texto preservado.")
    if number == 3:
        joined.setFont("Helvetica", 8)
        joined.drawString(65, 18, "RODAPE QUE NAO PODE SER CORTADO")
    if number == 4:
        joined.setFillColor(HexColor("#356f90"))
        joined.rect(70, 25, 120, 48, fill=1, stroke=0)
        joined.setFillColor(HexColor("#000000"))
    if number == 6:
        joined.setFont("Helvetica", 10)
        joined.setFillColor(HexColor("#fefefe"))
        joined.drawString(65, 20, "TEXTO MUITO CLARO PRESERVADO")
    joined.showPage()
joined.save()

# Chapter starts: outline metadata, explicit heading without an outline, and a
# short final chapter. The preceding lines must all remain readable.
chapters = canvas.Canvas(str(FIXTURES / "Capitulos.pdf"), pagesize=(595, 842))
for number in range(1, 7):
    chapters.setFillColor(HexColor("#000000"))
    start = 735
    if number == 2:
        chapters.bookmarkPage("chapter-two")
        chapters.addOutlineEntry("Uma nova viagem", "chapter-two", 0)
        chapters.setFont("Times-Bold", 25)
        chapters.drawString(65, 735, "Uma nova viagem")
        start = 670
    if number in [4, 6]:
        chapters.setFont("Times-Bold", 21)
        chapters.drawString(65, 735, "CAPITULO DOIS" if number == 4 else "CAPITULO TRES")
        start = 670
    chapters.setFont("Times-Roman", 15)
    count = 3 if number == 6 else 24
    for line in range(count):
        prefix = "ANTERIOR" if number == 1 else f"PAGINA {number}"
        chapters.drawString(65, start - line * 23, f"{prefix} LINHA {line + 1:02d} - conteudo preservado.")
    chapters.showPage()
chapters.save()
