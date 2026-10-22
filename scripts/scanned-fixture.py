import io
import random
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


output = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "Digitalizado grande.pdf"
output.parent.mkdir(parents=True, exist_ok=True)
document = canvas.Canvas(str(output), pagesize=(595, 842))
rng = random.Random(42)
for number in range(18):
    image = Image.frombytes("RGB", (1400, 1900), rng.randbytes(1400 * 1900 * 3))
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((100, 100, 1300, 300), fill="white")
    drawing.text(
        (140, 180),
        f"FOLIO - PAGINA DIGITALIZADA {number + 1}",
        fill="black",
        font_size=46,
    )
    stream = io.BytesIO()
    image.save(stream, format="JPEG", quality=86)
    stream.seek(0)
    document.drawImage(ImageReader(stream), 0, 0, 595, 842)
    document.showPage()
document.save()
print(output, round(output.stat().st_size / 1048576, 2), "MB")
